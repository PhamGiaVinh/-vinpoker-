import type { VoiceCommandKind } from "@/lib/trackerVoice";

/**
 * Expected final ASR transcripts for a short physical Dealer UAT. The `spoken`
 * field records the utterance a Vietnamese-speaking dealer may say; regression
 * tests only parse `expectedTranscript` and do not claim ASR accuracy.
 */
export type DealerVoiceCorpusEntry = {
  category: "fold" | "check" | "call" | "bet" | "raise" | "all_in" | "seat";
  spoken: string;
  expectedTranscript: string;
  expectedParserCommand: VoiceCommandKind | null;
  expectedAmount: number | null;
};

export const DEALER_VOICE_CORPUS: readonly DealerVoiceCorpusEntry[] = [
  { category: "fold", spoken: "fold", expectedTranscript: "fold", expectedParserCommand: "fold", expectedAmount: null },
  { category: "fold", spoken: "bỏ bài", expectedTranscript: "bỏ bài", expectedParserCommand: "fold", expectedAmount: null },
  { category: "fold", spoken: "player fold", expectedTranscript: "player fold", expectedParserCommand: null, expectedAmount: null },
  { category: "fold", spoken: "người chơi bỏ bài", expectedTranscript: "người chơi bỏ bài", expectedParserCommand: null, expectedAmount: null },

  { category: "check", spoken: "check", expectedTranscript: "check", expectedParserCommand: "check", expectedAmount: null },
  { category: "check", spoken: "check bài", expectedTranscript: "check bài", expectedParserCommand: "check", expectedAmount: null },
  { category: "check", spoken: "xem", expectedTranscript: "xem", expectedParserCommand: "check", expectedAmount: null },
  { category: "check", spoken: "qua", expectedTranscript: "qua", expectedParserCommand: "check", expectedAmount: null },
  { category: "check", spoken: "player check", expectedTranscript: "player check", expectedParserCommand: null, expectedAmount: null },

  { category: "call", spoken: "call", expectedTranscript: "call", expectedParserCommand: "call", expectedAmount: null },
  { category: "call", spoken: "theo", expectedTranscript: "theo", expectedParserCommand: "call", expectedAmount: null },
  { category: "call", spoken: "theo bài", expectedTranscript: "theo bài", expectedParserCommand: "call", expectedAmount: null },
  { category: "call", spoken: "player call", expectedTranscript: "player call", expectedParserCommand: null, expectedAmount: null },

  { category: "all_in", spoken: "all in", expectedTranscript: "all in", expectedParserCommand: "all_in", expectedAmount: null },
  { category: "all_in", spoken: "all-in", expectedTranscript: "all-in", expectedParserCommand: "all_in", expectedAmount: null },
  { category: "all_in", spoken: "tất tay", expectedTranscript: "tất tay", expectedParserCommand: "all_in", expectedAmount: null },
  { category: "all_in", spoken: "tất cả chip", expectedTranscript: "tất cả chip", expectedParserCommand: "all_in", expectedAmount: null },

  { category: "bet", spoken: "bet 50k", expectedTranscript: "bet 50k", expectedParserCommand: "bet_to", expectedAmount: 50_000 },
  { category: "bet", spoken: "bet fifty thousand", expectedTranscript: "bet 50k", expectedParserCommand: "bet_to", expectedAmount: 50_000 },
  { category: "bet", spoken: "bet one hundred thousand", expectedTranscript: "bet one hundred thousand", expectedParserCommand: "bet_to", expectedAmount: 100_000 },
  { category: "bet", spoken: "bet to 120k", expectedTranscript: "bet 120k", expectedParserCommand: "bet_to", expectedAmount: 120_000 },
  { category: "bet", spoken: "cược năm mươi nghìn", expectedTranscript: "cược năm mươi nghìn", expectedParserCommand: "bet_to", expectedAmount: 50_000 },
  { category: "bet", spoken: "cược một trăm nghìn", expectedTranscript: "cược một trăm nghìn", expectedParserCommand: "bet_to", expectedAmount: 100_000 },
  { category: "bet", spoken: "cược đến hai triệu", expectedTranscript: "cược đến hai triệu", expectedParserCommand: "bet_to", expectedAmount: 2_000_000 },
  { category: "bet", spoken: "cược lên 50k", expectedTranscript: "cược lên 50k", expectedParserCommand: "bet_to", expectedAmount: 50_000 },

  { category: "raise", spoken: "raise 50k", expectedTranscript: "raise 50k", expectedParserCommand: "raise_to", expectedAmount: 50_000 },
  { category: "raise", spoken: "raise 100k", expectedTranscript: "raise 100k", expectedParserCommand: "raise_to", expectedAmount: 100_000 },
  { category: "raise", spoken: "raise 120k", expectedTranscript: "raise 120k", expectedParserCommand: "raise_to", expectedAmount: 120_000 },
  { category: "raise", spoken: "raise to 50k", expectedTranscript: "raise to 50k", expectedParserCommand: "raise_to", expectedAmount: 50_000 },
  { category: "raise", spoken: "raise to one hundred thousand", expectedTranscript: "raise to one hundred thousand", expectedParserCommand: "raise_to", expectedAmount: 100_000 },
  { category: "raise", spoken: "raise one hundred twenty thousand", expectedTranscript: "raise one hundred twenty thousand", expectedParserCommand: "raise_to", expectedAmount: 120_000 },
  { category: "raise", spoken: "nâng lên 120 nghìn", expectedTranscript: "nâng lên 120 nghìn", expectedParserCommand: "raise_to", expectedAmount: 120_000 },
  { category: "raise", spoken: "tố lên 50k", expectedTranscript: "tố lên 50k", expectedParserCommand: "raise_to", expectedAmount: 50_000 },
  { category: "raise", spoken: "rây năm mươi nghìn", expectedTranscript: "raise 50k", expectedParserCommand: "raise_to", expectedAmount: 50_000 },
  { category: "raise", spoken: "rây một trăm nghìn", expectedTranscript: "raise 100k", expectedParserCommand: "raise_to", expectedAmount: 100_000 },
  { category: "raise", spoken: "rây một trăm hai mươi nghìn", expectedTranscript: "raise 120k", expectedParserCommand: "raise_to", expectedAmount: 120_000 },

  { category: "seat", spoken: "seat one", expectedTranscript: "seat one", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat two", expectedTranscript: "seat two", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat three", expectedTranscript: "seat three", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat four", expectedTranscript: "seat four", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat five", expectedTranscript: "seat five", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat six", expectedTranscript: "seat six", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat seven", expectedTranscript: "seat seven", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat eight", expectedTranscript: "seat eight", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "seat nine", expectedTranscript: "seat nine", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít một", expectedTranscript: "seat one", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít hai", expectedTranscript: "seat two", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít ba", expectedTranscript: "seat three", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít bốn", expectedTranscript: "seat four", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít năm", expectedTranscript: "seat five", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít sáu", expectedTranscript: "seat six", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít bảy", expectedTranscript: "seat seven", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít tám", expectedTranscript: "seat eight", expectedParserCommand: null, expectedAmount: null },
  { category: "seat", spoken: "sít chín", expectedTranscript: "seat nine", expectedParserCommand: null, expectedAmount: null },
];
