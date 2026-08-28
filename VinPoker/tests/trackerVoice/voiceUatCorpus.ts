export interface VoiceUatCorpusCase {
  id: string;
  group: "simple" | "amount" | "control" | "negative";
  transcript: string;
  options?: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean };
  expected: {
    kind: string | null;
    amount: number | null;
    amountAmbiguous: boolean;
  };
}

const simple = (kind: string, utterances: string[]): VoiceUatCorpusCase[] => utterances.map((transcript, index) => ({
  id: `simple-${kind}-${index + 1}`,
  group: "simple",
  transcript,
  expected: { kind, amount: null, amountAmbiguous: false },
}));

const amountPhrases: Array<[string, number]> = [
  ["50k", 50_000],
  ["80 nghìn", 80_000],
  ["một trăm nghìn", 100_000],
  ["một trăm hai mươi nghìn", 120_000],
  ["150k", 150_000],
  ["hai trăm nghìn", 200_000],
  ["250 nghìn", 250_000],
  ["năm trăm nghìn", 500_000],
  ["1 triệu", 1_000_000],
  ["một triệu hai", 1_200_000],
  ["1.2 million", 1_200_000],
  ["2 triệu rưỡi", 2_500_000],
  ["hai triệu năm trăm", 2_500_000],
  ["one hundred thousand", 100_000],
  ["one hundred twenty thousand", 120_000],
  ["năm mươi nghìn", 50_000],
  ["hai trăm năm mươi nghìn", 250_000],
  ["1 triệu 2", 1_200_000],
  ["2.5 million", 2_500_000],
  ["một triệu hai trăm", 1_200_000],
];

const amount = amountPhrases.flatMap(([phrase, value], index) => [
  { prefix: "bet", kind: "bet_to" },
  { prefix: "cược đến", kind: "bet_to" },
  { prefix: "raise", kind: "raise_to" },
  { prefix: "tố lên", kind: "raise_to" },
].map(({ prefix, kind }, variation) => ({
  id: `amount-${index + 1}-${variation + 1}`,
  group: "amount" as const,
  transcript: `${prefix} ${phrase}`,
  expected: { kind, amount: value, amountAmbiguous: false },
})));

const negativeUtterances = [
  "dealer is talking to another person",
  "người chơi đang suy nghĩ",
  "raise your hand",
  "call điện thoại",
  "check camera",
  "bỏ cái này ra",
  "tất cả người chơi",
  "the floor is wet",
  "tôi đang nói về cược cũ",
  "microphone check one two",
  "please fold the table cloth",
  "all players are ready",
  "raise the blinds tomorrow",
  "call me after the hand",
  "camera is checking the room",
  "bỏ qua phần giới thiệu",
  "người chia bài đang đợi",
  "điện thoại đang đổ chuông",
  "khán giả đang nói chuyện",
  "tất cả nhân viên vào bàn",
];

const RAW_VOICE_UAT_CORPUS: readonly VoiceUatCorpusCase[] = [
  ...simple("fold", [
    "fold", "bỏ", "bỏ bài", "úp bài", "dealer fold", "tôi fold", "em bỏ bài", "fold now", "bỏ luôn", "úp bài đi",
    "fold hand", "bỏ ván này", "cho tôi fold", "fold please", "bỏ bài nhé", "úp bài luôn", "tôi bỏ", "fold dealer", "bỏ đi", "fold this hand",
  ]),
  ...simple("check", [
    "check", "xem", "qua", "check bài", "dealer check", "tôi check", "em xem", "check now", "qua lượt", "check luôn",
    "cho tôi check", "xem bài", "check please", "qua đi", "tôi qua", "check dealer", "xem luôn", "check this street", "qua lượt nhé", "check hand",
  ]),
  ...simple("call", [
    "call", "theo", "theo bài", "dealer call", "tôi call", "em theo", "call now", "theo luôn", "call please", "cho tôi call",
    "theo đi", "call dealer", "tôi theo", "call this bet", "theo bài nhé", "call hand", "theo luôn đi", "dealer theo", "call amount", "theo cược",
  ]),
  ...simple("all_in", [
    "all in", "all-in", "tất tay", "dealer all in", "tôi all in", "em tất tay", "all in now", "tất tay luôn", "all in please", "cho tôi all in",
    "tất cả chip", "all-in dealer", "tôi tất tay", "all in this hand", "tất tay đi", "all in luôn", "dealer tất tay", "all in stack", "tất tay nhé", "all in hand",
  ]),
  ...amount,
  ...simple("report_wrong_action", [
    "báo sai", "báo sai action", "sai action", "tracker sai", "action sai", "wrong action", "dealer báo sai", "báo sai đi", "tracker ghi sai", "sai hành động",
  ]).map((item, index) => ({ ...item, id: `control-report-${index + 1}`, group: "control" as const })),
  ...simple("call_floor", [
    "gọi Floor", "Floor ơi", "cần Floor", "call Floor", "dealer gọi Floor", "gọi Floor đi", "Floor hỗ trợ", "cần Floor ngay", "call floor please", "Floor tới bàn",
  ]).map((item, index) => ({ ...item, id: `control-floor-${index + 1}`, group: "control" as const })),
  ...negativeUtterances.map((transcript, index) => ({
    id: `negative-${index + 1}`,
    group: "negative" as const,
    transcript,
    expected: { kind: null, amount: null, amountAmbiguous: false },
  })),
];

// Full-utterance grammar is intentional: conversational prefixes and suffixes
// become explicit negatives instead of silently proposing poker actions.
const CANONICAL_SHORT_COMMANDS = new Set([
  "fold", "bỏ", "bỏ bài", "úp bài", "check", "xem", "qua", "check bài", "call", "theo", "theo bài",
  "all in", "all-in", "tất tay", "tất cả chip", "báo sai", "báo sai action", "sai action", "tracker sai",
  "action sai", "wrong action", "tracker ghi sai", "sai hành động", "gọi floor", "floor ơi", "cần floor",
  "call floor", "floor hỗ trợ", "floor tới bàn",
]);

export const VOICE_UAT_CORPUS: readonly VoiceUatCorpusCase[] = RAW_VOICE_UAT_CORPUS.map((entry) => {
  if (entry.group === "amount" || entry.group === "negative") return entry;
  return CANONICAL_SHORT_COMMANDS.has(entry.transcript.toLocaleLowerCase("vi-VN"))
    ? entry
    : { ...entry, expected: { kind: null, amount: null, amountAmbiguous: false } };
});

if (VOICE_UAT_CORPUS.length !== 200) {
  throw new Error(`voice_uat_corpus_must_have_200_cases:${VOICE_UAT_CORPUS.length}`);
}
