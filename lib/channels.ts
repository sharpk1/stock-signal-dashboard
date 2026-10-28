export interface Channel {
  id: number;
  channelId: string;
  handle: string;
  name: string;
  weight: number;
  source?: 'youtube' | 'substack';
  substackHandle?: string;
  /**
   * Which slice of a channel's uploads to pull. YouTube keeps a system playlist
   * per upload type, and a channel's main feed mixes all of them together with
   * no duration or type field to filter on — so the playlist is the only
   * reliable filter.
   *
   *   'streams'  — completed livestreams only (no Shorts, no regular uploads)
   *   'longform' — regular long-form uploads only (no Shorts, no livestreams)
   *
   * Omitted pulls the channel's whole feed.
   */
  feed?: ChannelFeed;
}

export type ChannelFeed = 'streams' | 'longform';

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
    feed: 'streams',
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
    feed: 'longform',
  },
];
