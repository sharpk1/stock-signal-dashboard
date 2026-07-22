import { CHANNELS } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript } from '@/lib/db';
import { fetchRecentVideos, fetchTranscript } from '@/lib/youtube';
import { fetchSubstackPosts, extractSubstackContent, SubstackPost } from '@/lib/substack';
import { extractTickers, generateSummary } from '@/lib/extract';

async function main() {
  const db = getDb();
  let videosProcessed = 0;
  let tickersFound = 0;

  for (const channel of CHANNELS) {
    saveChannel(db, channel);

    let videos: Array<SubstackPost | Awaited<ReturnType<typeof fetchRecentVideos>>[number]>;
    try {
      if (channel.source === 'substack') {
        videos = await fetchSubstackPosts(channel.substackHandle!);
      } else {
        videos = await fetchRecentVideos(channel);
      }
    } catch (err) {
      console.error(`${channel.name}: fetch failed —`, err);
      continue;
    }

    if (videos.length === 0) {
      console.log(`${channel.name}: no new videos in last 3 days`);
      continue;
    }

    for (const video of videos) {
      const videoRowId = saveVideo(db, {
        videoId: video.videoId,
        channelId: channel.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
      });

      const existing = db.prepare(`
        SELECT v.transcript,
               (SELECT COUNT(*) FROM ticker_mentions WHERE video_id = v.id) AS mention_count
        FROM videos v WHERE v.id = ?
      `).get(videoRowId) as { transcript: string | null; mention_count: number };

      if (existing.transcript && existing.mention_count > 0) {
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      let transcript = '';
      if (existing.transcript) {
        transcript = existing.transcript;
      } else {
        try {
          if (channel.source === 'substack') {
            const post = video as SubstackPost;
            const { youtubeVideoId, articleText } = extractSubstackContent(post.bodyHtml);
            if (youtubeVideoId) {
              try {
                transcript = await fetchTranscript(youtubeVideoId);
              } catch {
                if (!articleText) { console.error(`${channel.name} / ${video.videoId}: no transcript or article text`); continue; }
                transcript = articleText;
              }
            } else {
              if (!articleText) { console.error(`${channel.name} / ${video.videoId}: empty body`); continue; }
              transcript = articleText;
            }
          } else {
            transcript = await fetchTranscript(video.videoId);
          }
        } catch (err) {
          console.error(`${channel.name} / ${video.videoId}: transcript failed —`, err);
          continue;
        }

        let summary = '';
        try { summary = await generateSummary(transcript); } catch (err) {
          console.error(`${channel.name} / ${video.title}: summary failed —`, err);
        }
        updateVideoTranscript(db, videoRowId, transcript, summary);
      }

      let mentions;
      try {
        mentions = await extractTickers(transcript, video.title);
      } catch (err) {
        console.error(`${channel.name} / ${video.title}: extraction failed —`, err);
        continue;
      }

      for (const mention of mentions) {
        saveMention(db, {
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
      console.log(`Processed: ${video.title} — ${mentions.length} tickers`);
    }
  }

  console.log(`\nDone: ${videosProcessed} videos, ${tickersFound} tickers`);
}

main().catch(err => { console.error(err); process.exit(1); });
