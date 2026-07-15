import { NextResponse } from 'next/server';

export interface WinRateCall {
  ticker: string;
  company: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: number;
  date: string;
  video_title: string;
  entry_price: number;
  current_price: number;
  return_pct: number;
  outcome: 'win' | 'loss' | 'skip';
}

export interface ChannelWinRate {
  channel_name: string;
  wins: number;
  losses: number;
  skips: number;
  win_rate: number;
  calls: WinRateCall[];
}

const DATA: ChannelWinRate[] = [
  {
    channel_name: 'Mark Meldrum',
    wins: 9,
    losses: 3,
    skips: 0,
    win_rate: 75,
    calls: [
      { ticker: 'AMKR', company: 'Amkor Technology', sentiment: 'bullish', conviction: 85, date: '2026-06-24', video_title: 'Amkor - Spotlight Company', entry_price: 24.10, current_price: 27.40, return_pct: 13.7, outcome: 'win' },
      { ticker: 'NVDA', company: 'NVIDIA', sentiment: 'bullish', conviction: 78, date: '2026-06-18', video_title: 'Semiconductor Sector Deep Dive', entry_price: 131.20, current_price: 128.50, return_pct: -2.1, outcome: 'loss' },
      { ticker: 'TSLA', company: 'Tesla', sentiment: 'bearish', conviction: 62, date: '2026-06-10', video_title: 'EV Market Reality Check', entry_price: 312.00, current_price: 295.20, return_pct: -5.4, outcome: 'win' },
      { ticker: 'JPM', company: 'JPMorgan Chase', sentiment: 'bullish', conviction: 80, date: '2026-06-05', video_title: 'Banking Sector Q2 Review', entry_price: 215.00, current_price: 228.30, return_pct: 6.2, outcome: 'win' },
      { ticker: 'ARM', company: 'Arm Holdings', sentiment: 'bullish', conviction: 72, date: '2026-06-02', video_title: 'Compute Platform Landscape', entry_price: 128.40, current_price: 140.10, return_pct: 9.1, outcome: 'win' },
      { ticker: 'INTC', company: 'Intel', sentiment: 'bearish', conviction: 65, date: '2026-05-28', video_title: 'Intel — Is The Turnaround Real?', entry_price: 22.80, current_price: 20.90, return_pct: -8.3, outcome: 'win' },
      { ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 55, date: '2026-05-22', video_title: 'Big Tech Earnings Recap', entry_price: 198.40, current_price: 204.70, return_pct: 3.2, outcome: 'win' },
      { ticker: 'MSFT', company: 'Microsoft', sentiment: 'bullish', conviction: 70, date: '2026-05-18', video_title: 'AI Infrastructure Stocks', entry_price: 422.10, current_price: 415.80, return_pct: -1.5, outcome: 'loss' },
      { ticker: 'RKLB', company: 'Rocket Lab', sentiment: 'bullish', conviction: 88, date: '2026-05-14', video_title: 'Rocket Lab — Worth The Premium?', entry_price: 17.20, current_price: 21.10, return_pct: 22.7, outcome: 'win' },
      { ticker: 'SMCI', company: 'Super Micro Computer', sentiment: 'bearish', conviction: 75, date: '2026-05-10', video_title: 'Super Micro Accounting Concerns', entry_price: 38.50, current_price: 33.80, return_pct: -12.2, outcome: 'win' },
      { ticker: 'LLY', company: 'Eli Lilly', sentiment: 'bullish', conviction: 68, date: '2026-05-06', video_title: 'Eli Lilly Pipeline Update', entry_price: 848.20, current_price: 889.00, return_pct: 4.8, outcome: 'win' },
      { ticker: 'SBUX', company: 'Starbucks', sentiment: 'bearish', conviction: 55, date: '2026-05-01', video_title: 'Starbucks Turnaround — Too Early?', entry_price: 88.40, current_price: 90.20, return_pct: 2.0, outcome: 'loss' },
    ],
  },
  {
    channel_name: 'Financial Education',
    wins: 8,
    losses: 7,
    skips: 0,
    win_rate: 53,
    calls: [
      { ticker: 'MSFT', company: 'Microsoft', sentiment: 'bullish', conviction: 72, date: '2026-06-22', video_title: 'My Top Stock Pick Right Now', entry_price: 419.80, current_price: 432.80, return_pct: 3.1, outcome: 'win' },
      { ticker: 'COIN', company: 'Coinbase', sentiment: 'bullish', conviction: 88, date: '2026-06-18', video_title: 'Coinbase Is Undervalued‼️', entry_price: 265.40, current_price: 227.80, return_pct: -14.2, outcome: 'loss' },
      { ticker: 'SOFI', company: 'SoFi Technologies', sentiment: 'bullish', conviction: 65, date: '2026-06-14', video_title: 'SOFI Stock — Hidden Gem?', entry_price: 12.80, current_price: 13.90, return_pct: 8.6, outcome: 'win' },
      { ticker: 'HOOD', company: 'Robinhood', sentiment: 'bullish', conviction: 70, date: '2026-06-10', video_title: 'Robinhood Is Growing FAST', entry_price: 34.20, current_price: 32.50, return_pct: -5.0, outcome: 'loss' },
      { ticker: 'PLTR', company: 'Palantir', sentiment: 'bullish', conviction: 82, date: '2026-06-06', video_title: 'Palantir Stock Analysis', entry_price: 76.40, current_price: 85.40, return_pct: 11.8, outcome: 'win' },
      { ticker: 'AMD', company: 'Advanced Micro Devices', sentiment: 'bullish', conviction: 68, date: '2026-06-01', video_title: 'AMD vs NVIDIA — My Warning', entry_price: 148.60, current_price: 143.80, return_pct: -3.2, outcome: 'loss' },
      { ticker: 'NVDA', company: 'NVIDIA', sentiment: 'bullish', conviction: 85, date: '2026-05-26', video_title: 'NVIDIA Stock — Still Worth It?', entry_price: 128.90, current_price: 126.20, return_pct: -2.1, outcome: 'loss' },
      { ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 60, date: '2026-05-20', video_title: 'Apple Intelligence Will Change Everything', entry_price: 196.20, current_price: 202.40, return_pct: 3.2, outcome: 'win' },
      { ticker: 'AMZN', company: 'Amazon', sentiment: 'bullish', conviction: 75, date: '2026-05-14', video_title: 'My Warning to All Investors‼️', entry_price: 212.40, current_price: 226.60, return_pct: 6.7, outcome: 'win' },
      { ticker: 'GOOGL', company: 'Alphabet', sentiment: 'bullish', conviction: 70, date: '2026-05-08', video_title: 'Google Stock Analysis 2026', entry_price: 176.20, current_price: 184.80, return_pct: 4.9, outcome: 'win' },
      { ticker: 'TSLA', company: 'Tesla', sentiment: 'bullish', conviction: 55, date: '2026-05-02', video_title: 'Tesla Stock — Buying Opportunity?', entry_price: 298.40, current_price: 248.10, return_pct: -16.8, outcome: 'loss' },
      { ticker: 'MSTR', company: 'MicroStrategy', sentiment: 'bullish', conviction: 60, date: '2026-04-26', video_title: 'Bitcoin Proxy Stocks to Buy', entry_price: 374.20, current_price: 431.10, return_pct: 15.2, outcome: 'win' },
      { ticker: 'DDOG', company: 'Datadog', sentiment: 'bullish', conviction: 72, date: '2026-04-20', video_title: 'Top Software Stocks to Watch', entry_price: 140.80, current_price: 153.30, return_pct: 8.9, outcome: 'win' },
      { ticker: 'NET', company: 'Cloudflare', sentiment: 'bullish', conviction: 65, date: '2026-04-14', video_title: 'The Best AI Infrastructure Play', entry_price: 118.60, current_price: 115.90, return_pct: -2.3, outcome: 'loss' },
      { ticker: 'CRWD', company: 'CrowdStrike', sentiment: 'bullish', conviction: 68, date: '2026-04-08', video_title: 'Cybersecurity Stocks 2026', entry_price: 390.20, current_price: 374.10, return_pct: -4.1, outcome: 'loss' },
    ],
  },
  {
    channel_name: 'Dumb Money Live',
    wins: 6,
    losses: 8,
    skips: 0,
    win_rate: 43,
    calls: [
      { ticker: 'GME', company: 'GameStop', sentiment: 'bullish', conviction: 55, date: '2026-06-20', video_title: 'ROARING KITTY IS BACK 🚀', entry_price: 28.40, current_price: 22.00, return_pct: -22.5, outcome: 'loss' },
      { ticker: 'AMC', company: 'AMC Entertainment', sentiment: 'bullish', conviction: 60, date: '2026-06-16', video_title: 'AMC Squeeze Setup?', entry_price: 4.20, current_price: 3.44, return_pct: -18.1, outcome: 'loss' },
      { ticker: 'TSLA', company: 'Tesla', sentiment: 'bullish', conviction: 75, date: '2026-06-12', video_title: 'Tesla Dip — BUY NOW?', entry_price: 302.80, current_price: 252.40, return_pct: -16.6, outcome: 'loss' },
      { ticker: 'PLTR', company: 'Palantir', sentiment: 'bullish', conviction: 65, date: '2026-06-08', video_title: 'Palantir — The AI Play Everyone Misses', entry_price: 74.20, current_price: 83.00, return_pct: 11.9, outcome: 'win' },
      { ticker: 'NVDA', company: 'NVIDIA', sentiment: 'bullish', conviction: 80, date: '2026-06-04', video_title: 'NVIDIA Is A BUY Right Now', entry_price: 129.80, current_price: 127.10, return_pct: -2.1, outcome: 'loss' },
      { ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 58, date: '2026-05-30', video_title: 'Apple — Still A Buy?', entry_price: 195.40, current_price: 201.60, return_pct: 3.2, outcome: 'win' },
      { ticker: 'COIN', company: 'Coinbase', sentiment: 'bullish', conviction: 72, date: '2026-05-26', video_title: 'Crypto Stocks Are ON FIRE', entry_price: 258.60, current_price: 221.80, return_pct: -14.2, outcome: 'loss' },
      { ticker: 'MSFT', company: 'Microsoft', sentiment: 'bullish', conviction: 62, date: '2026-05-22', video_title: 'Microsoft Stock Review', entry_price: 418.20, current_price: 431.20, return_pct: 3.1, outcome: 'win' },
      { ticker: 'ARM', company: 'Arm Holdings', sentiment: 'bullish', conviction: 68, date: '2026-05-18', video_title: 'ARM Stock — Hidden Gem', entry_price: 126.80, current_price: 138.40, return_pct: 9.1, outcome: 'win' },
      { ticker: 'AMZN', company: 'Amazon', sentiment: 'bullish', conviction: 72, date: '2026-05-14', video_title: 'Amazon Stock Analysis', entry_price: 210.80, current_price: 225.00, return_pct: 6.7, outcome: 'win' },
      { ticker: 'META', company: 'Meta Platforms', sentiment: 'bullish', conviction: 70, date: '2026-05-10', video_title: 'Meta Is My TOP Pick', entry_price: 614.20, current_price: 659.00, return_pct: 7.3, outcome: 'win' },
      { ticker: 'HOOD', company: 'Robinhood', sentiment: 'bullish', conviction: 65, date: '2026-05-06', video_title: 'Robinhood Earnings Play', entry_price: 33.80, current_price: 32.10, return_pct: -5.0, outcome: 'loss' },
      { ticker: 'CRSP', company: 'CRISPR Therapeutics', sentiment: 'bullish', conviction: 55, date: '2026-05-02', video_title: 'Biotech Stocks To Watch', entry_price: 42.60, current_price: 39.00, return_pct: -8.5, outcome: 'loss' },
      { ticker: 'SOFI', company: 'SoFi Technologies', sentiment: 'bullish', conviction: 60, date: '2026-04-28', video_title: 'SOFI Earnings Preview', entry_price: 13.20, current_price: 12.64, return_pct: -4.2, outcome: 'loss' },
    ],
  },
  {
    channel_name: 'The Maverick of Wall Street',
    wins: 5,
    losses: 2,
    skips: 1,
    win_rate: 71,
    calls: [
      { ticker: 'EWY', company: 'iShares MSCI South Korea ETF', sentiment: 'bearish', conviction: 78, date: '2026-06-24', video_title: 'The South Korean Market Is Nearing A Sudden Epic Crash', entry_price: 64.80, current_price: 59.30, return_pct: -8.5, outcome: 'win' },
      { ticker: 'EWT', company: 'iShares MSCI Taiwan ETF', sentiment: 'bullish', conviction: 65, date: '2026-06-18', video_title: 'Taiwan — The Semiconductor Superpower', entry_price: 40.20, current_price: 42.30, return_pct: 5.2, outcome: 'win' },
      { ticker: 'FXI', company: 'iShares China Large-Cap ETF', sentiment: 'bearish', conviction: 60, date: '2026-06-12', video_title: 'China Stimulus — Too Little Too Late', entry_price: 32.80, current_price: 31.60, return_pct: -3.7, outcome: 'win' },
      { ticker: 'EEM', company: 'iShares MSCI Emerging Markets ETF', sentiment: 'bullish', conviction: 72, date: '2026-06-06', video_title: 'Emerging Markets Setup', entry_price: 42.40, current_price: 44.20, return_pct: 4.2, outcome: 'win' },
      { ticker: 'GLD', company: 'SPDR Gold Shares ETF', sentiment: 'bullish', conviction: 80, date: '2026-05-30', video_title: 'Gold Breaking Out — Time To Buy', entry_price: 252.40, current_price: 272.20, return_pct: 7.8, outcome: 'win' },
      { ticker: 'SLV', company: 'iShares Silver Trust', sentiment: 'bullish', conviction: 68, date: '2026-05-24', video_title: 'Silver — The Better Buy Than Gold?', entry_price: 30.40, current_price: 29.76, return_pct: -2.1, outcome: 'loss' },
      { ticker: 'TLT', company: 'iShares 20+ Year Treasury ETF', sentiment: 'bullish', conviction: 55, date: '2026-05-18', video_title: 'Bonds Are About To Reverse', entry_price: 92.80, current_price: 88.90, return_pct: -4.2, outcome: 'loss' },
      { ticker: 'DXY', company: 'US Dollar Index', sentiment: 'neutral', conviction: 40, date: '2026-05-12', video_title: 'Dollar Strength — What It Means', entry_price: 104.20, current_price: 103.80, return_pct: -0.4, outcome: 'skip' },
    ],
  },
  {
    channel_name: 'Royce Jakob',
    wins: 4,
    losses: 2,
    skips: 0,
    win_rate: 67,
    calls: [
      { ticker: 'ARKG', company: 'ARK Genomic Revolution ETF', sentiment: 'bullish', conviction: 88, date: '2026-06-24', video_title: "The Only 2 Stocks I'm Actually Bullish On This Summer", entry_price: 8.20, current_price: 9.36, return_pct: 14.1, outcome: 'win' },
      { ticker: 'RIOT', company: 'Riot Platforms', sentiment: 'bullish', conviction: 72, date: '2026-06-24', video_title: "The Only 2 Stocks I'm Actually Bullish On This Summer", entry_price: 9.80, current_price: 9.00, return_pct: -8.2, outcome: 'loss' },
      { ticker: 'MSTR', company: 'MicroStrategy', sentiment: 'bullish', conviction: 65, date: '2026-06-18', video_title: "There's Always A Bull Market Somewhere!", entry_price: 388.40, current_price: 447.50, return_pct: 15.2, outcome: 'win' },
      { ticker: 'CLSK', company: 'CleanSpark', sentiment: 'bullish', conviction: 68, date: '2026-06-12', video_title: 'Trade With Your Head, NOT Your Heart', entry_price: 12.40, current_price: 11.70, return_pct: -5.6, outcome: 'loss' },
      { ticker: 'HUT', company: 'Hut 8 Mining', sentiment: 'bullish', conviction: 60, date: '2026-06-06', video_title: 'Bitcoin Miners Are Going Parabolic', entry_price: 11.20, current_price: 12.30, return_pct: 9.8, outcome: 'win' },
      { ticker: 'IREN', company: 'Iris Energy', sentiment: 'bullish', conviction: 55, date: '2026-05-30', video_title: 'The Best Bitcoin Mining Stock?', entry_price: 11.80, current_price: 13.30, return_pct: 12.7, outcome: 'win' },
    ],
  },
];

export async function GET() {
  return NextResponse.json(DATA);
}
