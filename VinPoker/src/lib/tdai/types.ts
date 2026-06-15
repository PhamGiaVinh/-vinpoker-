// Frozen TD AI contracts — the PR D (local demo) → PR E (real AI/RAG) seam,
// the same way TvData was the seam across the TV-clock phases.
//
// PR D fills these from a bundled DEMO rule set via keyword lookup ONLY:
// no LLM call, no DB, and NO authoritative TDA text. PR E's edge function will
// return the SAME TdAnswer shape from a sourced/versioned corpus + a model
// call, so the UI never changes. Everything here is advisory and clearly
// labelled DEMO — it is never an official ruling.

// "demo"/"house_demo" = PR D mock set. "summary" = paraphrased TDA topic,
// "house" = club rule — both used by the PR E corpus. None are verbatim TDA.
export type TdRuleSource = "demo" | "house_demo" | "summary" | "house";

export type TdStreet = "preflop" | "flop" | "turn" | "river" | "showdown" | "other";

export type TdConfidence = "low" | "medium" | "high";

// What kind of help an entry gives. "ruling" = dispute/rule resolution at the
// table (strict, cite-backed). "operations" = running the tournament (blind
// structure, color-up, balancing, breaks, late reg, payouts). "floor" = floor
// procedure / incidents (penalties, clock, seat issues, dealer errors).
// "strategy" = general educational poker advice (reference only, not a ruling).
// Optional for back-compat: an entry with no category is treated as "ruling".
export type TdRuleCategory = "ruling" | "operations" | "floor" | "strategy";

/** 'local' = PR D keyword lookup. 'ai' = PR E model synthesis. */
export type TdAnswerSource = "local" | "ai";

// Non-authoritative citation kinds. "tda_summary" = paraphrased TDA topic
// summary (NOT verbatim official text); "house" = club rule.
export type TdCitationKind = "tda_placeholder" | "house_demo" | "tda_summary" | "house";

export interface TdRule {
  id: string;
  topicEn: string;
  topicVi: string;
  /** Paraphrased DEMO summary — NOT verbatim/authoritative TDA text. */
  summaryEn: string;
  summaryVi: string;
  /** Search keywords, mixed vi + en (matched diacritic-insensitively). */
  keywords: string[];
  /** Suggested handling — advisory demo wording, never "phải xử…". */
  suggestionVi: string;
  /** Player-facing wording the floor can read out (demo). */
  playerWordingVi: string;
  /** Non-authoritative label, e.g. "TDA placeholder #44". */
  citationLabel: string;
  citationKind: TdCitationKind;
  source: TdRuleSource;
  /** Domain of help. Defaults to "ruling" when omitted (legacy entries). */
  category?: TdRuleCategory;
}

export interface TdCitation {
  ruleId: string;
  label: string;
  kind: TdCitationKind;
}

/** Operator's described situation (the form input). */
export interface TdSituation {
  tournamentId?: string;
  tableLabel?: string;
  street?: TdStreet;
  playersInvolved?: string;
  actionSequence?: string;
  /** Main free-text dispute description — the primary query. */
  description: string;
  houseRuleNote?: string;
}

/** The fixed answer-card payload. Shape frozen for PR E. */
export interface TdAnswer {
  source: TdAnswerSource; // 'local' in PR D
  isDemo: boolean; // always true in PR D
  recommendationVi: string; // Khuyến nghị (Gợi ý xử lý)
  citations: TdCitation[]; // Căn cứ
  reasoningVi: string; // Lập luận
  houseRuleOptionVi: string; // Phương án theo luật CLB
  playerWordingVi: string; // Cách nói với khách
  confidence: TdConfidence;
  needMoreInfoVi: string[]; // Cần hỏi thêm
  matchedRuleIds: string[];
}
