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

      // skip if already fully processed
      const existing = db.prepare('SELECT transcript FROM videos WHERE id = ?')
        .get(videoRowId) as { transcript: string | null };
      if (existing.transcript) {
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      let transcript: string;
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
        // store transcript without summary rather than failing the whole video
      }

      updateVideoTranscript(db, videoRowId, transcript, summary);

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
