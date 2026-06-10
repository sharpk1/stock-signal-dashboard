# Stock Signal Dashboard

Aggregates YouTube stock ticker mentions from 7 channels. Hit "Fetch Latest" to pull transcripts from the last 24 hours, Claude Haiku extracts tickers with sentiment and conviction, and the leaderboard ranks by weighted consensus score.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in your Anthropic API key
2. Fill in the `channelId` values in `lib/channels.ts` (visit each YouTube channel, view source, search for `"channelId":"`)
3. Install deps: `npm install`

## Run locally

```bash
npm run dev
```

Open http://localhost:3000. Hit "Fetch Latest" to pull today's data.

## Tests

```bash
npm test
```

## Note on deployment

Vercel's serverless filesystem is ephemeral — SQLite won't persist between invocations. For persistent hosting, deploy to Railway (supports volumes). For personal use, run locally.
