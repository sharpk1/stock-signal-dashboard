import { CHANNELS, Channel } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript, getLeaderboard, saveConvergenceAlert, bumpTranscriptAttempts } from '@/lib/db';
import { fetchRecentVideos, fetchTranscript } from '@/lib/youtube';
import { fetchSubstackPosts, extractSubstackContent, SubstackPost } from '@/lib/substack';
import { extractTickers, generateSummary } from '@/lib/extract';

const MAX_TRANSCRIPT_ATTEMPTS = 3; // give up on a video after this many failed runs
const TIME_BUDGET_MS = 240_000;    // stop gracefully before Vercel's 300s hard limit

export interface NewVideo {
  title: string;
  channelName: string;
  url: string;
  tickers: string[];
}

export interface FetchResult {
  success: true;
  timedOut: boolean;
  videosProcessed: number;
  tickersFound: number;
  errors: string[];
  newAlerts: string[];
  newVideos: NewVideo[];
}

function videoUrl(channel: Channel, videoId: string): string {
  if (channel.source === 'substack') {
    return `https://${channel.substackHandle}.substack.com/p/${videoId}`;
  }
  return `https://youtube.com/watch?v=${videoId}`;
}

export async function runFetch(): Promise<FetchResult> {
  const db = await getDb();
  const errors: string[] = [];
  let videosProcessed = 0;
  let tickersFound = 0;
  const newVideos: NewVideo[] = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  let timedOut = false;

  for (const channel of CHANNELS) {
    if (timedOut) break;
    await saveChannel(db, channel);

    let videos: Array<SubstackPost | Awaited<ReturnType<typeof fetchRecentVideos>>[number]>;
    try {
      if (channel.source === 'substack') {
        videos = await fetchSubstackPosts(channel.substackHandle!);
      } else {
        videos = await fetchRecentVideos(channel);
      }
    } catch (err) {
      const msg = `${channel.name}: fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      continue;
    }

    if (videos.length === 0) {
      console.log(`${channel.name}: no new videos in window`);
      continue;
    }

    for (const video of videos) {
      if (Date.now() > deadline) {
        timedOut = true;
        errors.push('time budget reached — stopping early; run again to continue');
        console.log('Time budget reached, stopping early.');
        break;
      }

      const videoRowId = await saveVideo(db, {
        videoId: video.videoId,
        channelId: channel.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
      });

      // Check processing state
      const existing = (await db.execute({
        sql: `
        SELECT v.transcript, v.transcript_attempts,
               (SELECT COUNT(*) FROM ticker_mentions WHERE video_id = v.id) AS mention_count
        FROM videos v WHERE v.id = ?
      `,
        args: [videoRowId],
      })).rows[0] as unknown as { transcript: string | null; transcript_attempts: number; mention_count: number };

      if (existing.transcript && existing.mention_count > 0) {
        // fully processed — skip
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      if (!existing.transcript && existing.transcript_attempts >= MAX_TRANSCRIPT_ATTEMPTS) {
        // repeatedly couldn't get a transcript (likely no captions) — stop retrying
        console.log(`Skipped (no transcript after ${existing.transcript_attempts} attempts): ${video.title}`);
        continue;
      }

      // Fresh content = first time we've pulled a transcript for this video.
      // This is what gets reported as "new" (reprocessed videos don't count).
      const isFreshContent = !existing.transcript;

      let transcript: string = '';
      if (existing.transcript) {
        // transcript stored but extraction previously failed — reuse stored transcript
        transcript = existing.transcript;
      } else {
        // fresh content — fetch transcript or use article text
        try {
          if (channel.source === 'substack') {
            const post = video as SubstackPost;
            const { youtubeVideoId, articleText } = extractSubstackContent(post.bodyHtml);
            if (youtubeVideoId) {
              try {
                transcript = await fetchTranscript(youtubeVideoId);
              } catch {
                if (!articleText) {
                  const msg = `${channel.name} / ${video.videoId}: no transcript and no article text — skipping`;
                  errors.push(msg);
                  console.error(msg);
                  continue;
                }
                console.warn(`${channel.name} / ${video.videoId}: YouTube transcript failed, falling back to article text`);
                transcript = articleText;
              }
            } else {
              if (!articleText) {
                const msg = `${channel.name} / ${video.videoId}: empty body — skipping`;
                errors.push(msg);
                console.error(msg);
                continue;
              }
              transcript = articleText;
            }
          } else {
            transcript = await fetchTranscript(video.videoId);
          }
        } catch (err) {
          await bumpTranscriptAttempts(db, videoRowId);
          const msg = `${channel.name} / ${video.videoId}: transcript unavailable — ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          console.error(msg);
          continue;
        }

        let summary = '';
        try {
          summary = await generateSummary(transcript);
        } catch (err) {
          console.error(`${channel.name} / ${video.title}: summary generation failed — ${err instanceof Error ? err.message : err}`);
        }

        await updateVideoTranscript(db, videoRowId, transcript, summary);
      }

      let mentions;
      try {
        mentions = await extractTickers(transcript, video.title);
      } catch (err) {
        const msg = `${channel.name} / ${video.title}: Claude extraction failed — ${err instanceof Error ? err.message : err}`;
        errors.push(msg);
        console.error(msg);
        continue;
      }

      for (const mention of mentions) {
        await saveMention(db, {
          videoRowId,
          ticker: mention.ticker.toUpperCase(),
          company: mention.company ?? null,
          sentiment: mention.sentiment,
          conviction: mention.conviction,
          quote: mention.quote ?? null,
        });
        tickersFound++;
      }

      videosProcessed++;
      if (isFreshContent) {
        newVideos.push({
          title: video.title,
          channelName: channel.name,
          url: videoUrl(channel, video.videoId),
          tickers: mentions.map(m => m.ticker.toUpperCase()),
        });
      }
      console.log(`Processed: ${video.title} — ${mentions.length} tickers`);
    }
  }

  // Detect new convergences and save alerts
  const newAlerts: string[] = [];
  const leaderboard = await getLeaderboard(db, undefined, 30);
  for (const row of leaderboard) {
    if (row.rr_mentions > 0 && row.channel_count >= 2) {
      const channels = row.channels;
      const quotes = (await db.execute({
        sql: `
        SELECT tm.quote, c.name AS channel_name
        FROM ticker_mentions tm
        JOIN videos v ON tm.video_id = v.id
        JOIN channels c ON v.channel_id = c.channel_id
        WHERE tm.ticker = ? AND tm.quote IS NOT NULL
        ORDER BY c.weight DESC
        LIMIT 4
      `,
        args: [row.ticker],
      })).rows as unknown as { quote: string; channel_name: string }[];
      const quotesJson = JSON.stringify(quotes);
      const isNew = await saveConvergenceAlert(db, row.ticker, channels, quotesJson);
      if (isNew) newAlerts.push(row.ticker);
    }
  }

  return { success: true, timedOut, videosProcessed, tickersFound, errors, newAlerts, newVideos };
}
