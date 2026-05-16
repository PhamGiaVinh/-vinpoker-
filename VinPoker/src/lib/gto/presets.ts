// Built-in opening range presets (approximate, tournament/cash hybrid)
export const PRESETS: Record<string, string[]> = {
  UTG: [
    "AA","KK","QQ","JJ","TT","99","88","77",
    "AKs","AQs","AJs","ATs","KQs","KJs","QJs","JTs",
    "AKo","AQo",
  ],
  MP: [
    "AA","KK","QQ","JJ","TT","99","88","77","66",
    "AKs","AQs","AJs","ATs","A9s","KQs","KJs","KTs","QJs","QTs","JTs","T9s",
    "AKo","AQo","AJo","KQo",
  ],
  CO: [
    "AA","KK","QQ","JJ","TT","99","88","77","66","55","44",
    "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A5s",
    "KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","98s","87s","76s",
    "AKo","AQo","AJo","ATo","KQo","KJo","QJo",
  ],
  BTN: [
    "AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22",
    "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
    "KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s",
    "QJs","QTs","Q9s","Q8s","Q7s",
    "JTs","J9s","J8s","J7s",
    "T9s","T8s","T7s","98s","97s","87s","86s","76s","75s","65s","54s",
    "AKo","AQo","AJo","ATo","A9o","A8o","A7o","A5o",
    "KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","98o",
  ],
  SB: [
    "AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22",
    "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
    "KQs","KJs","KTs","K9s","K8s","K7s",
    "QJs","QTs","Q9s","Q8s",
    "JTs","J9s","J8s","T9s","T8s","98s","97s","87s","76s","65s","54s",
    "AKo","AQo","AJo","ATo","A9o","A8o",
    "KQo","KJo","KTo","K9o","QJo","QTo","JTo",
  ],
};

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES: PresetName[] = ["UTG", "MP", "CO", "BTN", "SB"];
