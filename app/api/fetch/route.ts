import { NextResponse } from 'next/server';
import { CHANNELS } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript } from '@/lib/db';
import { fetchRecentVideos, fetchTranscript } from '@/lib/youtube';
import { extractTickers, generateSummary } from '@/lib/extract';

export const maxDuration = 300;

export async function POST() {
  const db = getDb();
  const errors: string[] = [];
  let videosProcessed = 0;
  let tickersFound = 0;

  for (const channel of CHANNELS) {
    saveChannel(db, channel);

    let videos;
    try {
      videos = await fetchRecentVideos(channel);
    } catch (err) {
      const msg = `${channel.name}: RSS fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      continue;
    }

    if (videos.length === 0) {
      console.log(`${channel.name}: no new videos in last 24h`);
      continue;
    }

    for (const video of videos) {
      const videoRowId = saveVideo(db, {
        videoId: video.videoId,
        channelId: channel.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
      });

      // Check processing state
      const existing = db.prepare(`
        SELECT v.transcript,
               (SELECT COUNT(*) FROM ticker_mentions WHERE video_id = v.id) AS mention_count
        FROM videos v WHERE v.id = ?
      `).get(videoRowId) as { transcript: string | null; mention_count: number };

      if (existing.transcript && existing.mention_count > 0) {
        // fully processed — skip
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      let transcript: string;
      if (existing.transcript) {
        // transcript stored but extraction previously failed — reuse stored transcript
        transcript = existing.transcript;
      } else {
        // fresh video — fetch transcript and generate summary
        try {
          transcript = await fetchTranscript(video.videoId);
        } catch (err) {
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

        updateVideoTranscript(db, videoRowId, transcript, summary);
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

  return NextResponse.json({ success: true, videosProcessed, tickersFound, errors });
}
