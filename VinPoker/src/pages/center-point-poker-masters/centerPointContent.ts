import type { LucideIcon } from "lucide-react";
import { Crown, Gem, RadioTower, Trophy } from "lucide-react";

export type CenterPointEvent = {
  id: string;
  name: string;
  category: string;
  priceLabel: string;
  priceCaption: string;
  dateLabel: string;
  levelLabel: string;
  description: string;
  featured?: boolean;
  badge?: string;
};

export type CenterPointNews = {
  id: string;
  title: string;
  date: string;
  summary: string;
};

export type CenterPointFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export const navigationItems = [
  { label: "Home", target: "home" },
  { label: "Schedule", target: "events" },
  { label: "Events", target: "events" },
  { label: "Player Guide", target: "player-guide" },
  { label: "Results", target: "results" },
  { label: "News", target: "news" },
  { label: "About", target: "about" },
] as const;

export const centerPointEvents: CenterPointEvent[] = [
  {
    id: "kick-off",
    name: "Kick Off Event",
    category: "Opening Flight",
    priceLabel: "1,000,000 VND",
    priceCaption: "Buy-in",
    dateLabel: "May 25–28",
    levelLabel: "20–25 min level",
    description: "Begin Season 3 with a welcoming opening flight built for the first big battle of the series.",
  },
  {
    id: "main-event",
    name: "Main Event",
    category: "Championship",
    priceLabel: "64,000,000 VND",
    priceCaption: "Guaranteed",
    dateLabel: "Jun 05–10",
    levelLabel: "30–40 min level",
    description: "The centrepiece of Center Point Poker Masters Season 3: deep structures, a premier field, and the champion's plate.",
    featured: true,
  },
  {
    id: "high-roller",
    name: "High Roller",
    category: "Elite Event",
    priceLabel: "10,000,000 VND",
    priceCaption: "Buy-in",
    dateLabel: "Jun 07–09",
    levelLabel: "25–40 min level",
    description: "A focused high-stakes challenge for players ready to take on the Season 3 elite field.",
    badge: "MINI",
  },
  {
    id: "closer",
    name: "Closer Event",
    category: "Finale",
    priceLabel: "2,000,000 VND",
    priceCaption: "Buy-in",
    dateLabel: "Jun 11–12",
    levelLabel: "20–25 min level",
    description: "Close the series with a fast, memorable final event and one more chance to make the podium.",
  },
];

export const centerPointFeatures: CenterPointFeature[] = [
  { icon: Trophy, title: "Prestigious Championship", description: "Compete against the best players." },
  { icon: Gem, title: "Massive Prize Pool", description: "Guaranteed prize pools with pride." },
  { icon: Crown, title: "World Class Experience", description: "Professional setup from first deal to final hand." },
  { icon: RadioTower, title: "Live Updates & Coverage", description: "Real-time tournament action and standings." },
];

export const leaderboardGroups = {
  main: [
    ["Thanh Tung", "1,245,000"],
    ["Minh Khoa", "1,125,000"],
    ["Hoang Nam", "995,000"],
    ["Quoc Dat", "875,000"],
    ["Van Duc", "745,000"],
  ],
  highRoller: [
    ["Bao Long", "875,000"],
    ["Duc Anh", "750,000"],
    ["Gia Huy", "645,000"],
    ["Minh Hai", "560,000"],
    ["Tuan Kiet", "495,000"],
  ],
  kickOff: [
    ["Le Duy", "420,000"],
    ["Khanh An", "395,000"],
    ["Huu Phuc", "320,000"],
    ["Quang Huy", "285,000"],
    ["Tuan Pham", "240,000"],
  ],
} as const;

export const centerPointNews: CenterPointNews[] = [
  {
    id: "early-bird",
    title: "Early Bird Registration Now Open",
    date: "May 18, 2026",
    summary: "Secure a place in Season 3 through the early registration window. This demo keeps registration local and does not collect details.",
  },
  {
    id: "satellites",
    title: "Satellites to Main Event Running Daily",
    date: "May 12, 2026",
    summary: "Daily satellite events give players more paths toward the CPM Season 3 Main Event.",
  },
  {
    id: "guide",
    title: "Player Guide Updated for Season 3",
    date: "May 10, 2026",
    summary: "The latest guide brings venue, structure, and responsible-play information together in one place.",
  },
];

export const mockCountdownTarget = "2026-09-06T20:00:00+07:00";
