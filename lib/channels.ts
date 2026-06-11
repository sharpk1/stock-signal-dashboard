export interface Channel {
  id: number;
  channelId: string;
  handle: string;
  name: string;
  weight: number;
}

export const CHANNELS: Channel[] = [
  {
    id: 1,
    channelId: "UCnMn36GT_H0X-w5_ckLtlgQ",
    handle: "@FinancialEducation",
    name: "Financial Education",
    weight: 0.133,
  },
  {
    id: 3,
    channelId: "UCWbHt74zrW8sd3XqFABMXDw",
    handle: "@DumbMoneyLive",
    name: "Dumb Money Live",
    weight: 0.133,
  },
  {
    id: 4,
    channelId: "UCtgIZv41-YwzASc5BdF-7IA",
    handle: "@bravosresearch",
    name: "Bravo's Research",
    weight: 0.133,
  },
  {
    id: 5,
    channelId: "UCAHr-sT0AjrD3sBwr1eRUNg",
    handle: "@MarkMeldrum",
    name: "Mark Meldrum",
    weight: 0.133,
  },
  {
    id: 6,
    channelId: "UCvk0KB4Ue0vfPqvDzjIAwiQ",
    handle: "@TheMaverickofWallStreet",
    name: "The Maverick of Wall Street",
    weight: 0.133,
  },
  {
    id: 7,
    channelId: "UCPP6Eb5fUS38iHIscwWJSAw",
    handle: "@RoyceJakob",
    name: "Royce Jakob",
    weight: 0.2,
  },
];
