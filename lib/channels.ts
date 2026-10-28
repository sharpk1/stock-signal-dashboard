export interface Channel {
  id: number;
  channelId: string;
  handle: string;
  name: string;
  weight: number;
  source?: 'youtube' | 'substack';
  substackHandle?: string;
  /**
   * Pull this channel's live-streams playlist instead of its main uploads feed.
   * Dumb Money Live posts Shorts and clips alongside the streams Ray actually
   * wants, and only the streams playlist excludes them.
   */
  streamsOnly?: boolean;
}

export const CHANNELS: Channel[] = [
  {
    id: 1,
    channelId: "UCnMn36GT_H0X-w5_ckLtlgQ",
    handle: "@FinancialEducation",
    name: "Financial Education",
    weight: 0.1,
  },
  {
    id: 3,
    channelId: "UCS01CiRDAiyhR_mTHXDW23A",
    handle: "@DumbMoneyLive",
    name: "Dumb Money Live",
    weight: 0.1,
    streamsOnly: true,
  },
  {
    id: 4,
    channelId: "UCOHxDwCcOzBaLkeTazanwcw",
    handle: "@bravosresearch",
    name: "Bravo's Research",
    weight: 0.1,
  },
  {
    id: 5,
    channelId: "UCAHr-sT0AjrD3sBwr1eRUNg",
    handle: "@MarkMeldrum",
    name: "Mark Meldrum",
    weight: 0.1,
  },
  {
    id: 6,
    channelId: "UCvk0KB4Ue0vfPqvDzjIAwiQ",
    handle: "@TheMaverickofWallStreet",
    name: "The Maverick of Wall Street",
    weight: 0.1,
  },
  {
    id: 7,
    channelId: "UCPP6Eb5fUS38iHIscwWJSAw",
    handle: "@RoyceJakob",
    name: "Royce Jakob",
    weight: 0.15,
  },
  {
    id: 8,
    channelId: "thepopularinvestor",
    handle: "@thepopularinvestor",
    name: "Robert Reynolds",
    weight: 0.35,
    source: 'substack',
    substackHandle: 'thepopularinvestor',
  },
  {
    id: 9,
    channelId: "UCUvvj5lwue7PspotMDjk5UA",
    handle: "@MeetKevin",
    name: "Meet Kevin",
    weight: 0.1,
  },
];
