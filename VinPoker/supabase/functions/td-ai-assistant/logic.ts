// Deno port of the retrieval + no-hallucination validator.
// MIRRORS src/lib/tdai/{localSearch,retrieval,validateAnswer}.ts — those are
// the canonical versions with vitest golden tests; keep this in sync. Pure, no
// network, no imports beyond the committed rules-index.json (loaded by index.ts).

export interface TdRule {
  id: string;
  topicEn: string; topicVi: string;
  summaryEn: string; summaryVi: string;
  keywords: string[];
  suggestionVi: string; playerWordingVi: string;
  citationLabel: string; citationKind: string; source: string;
}
export type TdConfidence = "low" | "medium" | "high";
export interface TdCitation { ruleId: string; label: string; kind: string; }
export interface TdAnswer {
  source: "local" | "ai"; isDemo: boolean;
  recommendationVi: string; citations: TdCitation[]; reasoningVi: string;
  houseRuleOptionVi: string; playerWordingVi: string;
  confidence: TdConfidence; needMoreInfoVi: string[]; matchedRuleIds: string[];
}

export function normalize(input: string): string {
  return input.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set(["the","a","an","of","to","in","is","on","and","or","it","for",
  "khi","la","co","va","cua","mot","cho","voi","bi","da","thi","nay","anh","chi","em","ban","nguoi"]);

function tokenize(n: string): string[] {
  return n.split(" ").filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const SYNONYM_GROUPS: string[][] = [
  ["string bet","dat cuoc chuoi","cuoc chuoi","chuoi chip"],
  ["out of turn","sai luot","hanh dong sai luot","khong dung luot","act early"],
  ["exposed card","bai lo","lo bai","lat bai","show bai"],
  ["verbal","tuyen bo","noi mieng","tuyen bo mieng","declaration"],
  ["kill","muck","huy bai","bo bai","bai thang","winning hand"],
  ["odd chip","chip le","le chip","split pot","chia pot","chip du"],
  ["misdeal","chia bai loi","chia loi","loi chia bai","redeal","chia lai"],
  ["all in","to het","side pot","hu phu","pot phu","hu chinh"],
  ["wrong seat","sai ghe","ngoi sai","ghe sai","sai vi tri"],
  ["premature","board card","bai chung","lat som","flop som","turn som","river som"],
  ["away","roi ban","vang mat","khong co mat","absent","roi ghe"],
  ["unclear raise","raise khong ro","muc raise","ambiguous","mo ho","raise map mo"],
];

function expandTerms(nq: string): Set<string> {
  const terms = new Set(tokenize(nq));
  for (const g of SYNONYM_GROUPS) {
    if (g.some((p) => nq.includes(p))) for (const p of g) for (const t of tokenize(p)) terms.add(t);
  }
  return terms;
}

const W_KEYWORD = 3, W_TOPIC = 2, W_SUMMARY = 1, MIN_HIT_SCORE = 2;
export const RETRIEVAL_MIN_SCORE = 3;

export interface Hit { rule: TdRule; score: number; }

export function searchRules(query: string, rules: TdRule[]): Hit[] {
  const terms = expandTerms(normalize(query));
  if (terms.size === 0) return [];
  const hits: Hit[] = [];
  for (const rule of rules) {
    const kw = new Set<string>();
    for (const k of rule.keywords) for (const t of tokenize(normalize(k))) kw.add(t);
    const topic = new Set(tokenize(normalize(`${rule.topicEn} ${rule.topicVi}`)));
    const summary = new Set(tokenize(normalize(`${rule.summaryEn} ${rule.summaryVi}`)));
    let score = 0;
    for (const t of terms) {
      if (kw.has(t)) score += W_KEYWORD;
      else if (topic.has(t)) score += W_TOPIC;
      else if (summary.has(t)) score += W_SUMMARY;
    }
    if (score >= MIN_HIT_SCORE) hits.push({ rule, score });
  }
  hits.sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id));
  return hits;
}

export function retrieve(query: string, rules: TdRule[], k = 8): { hits: Hit[]; belowThreshold: boolean } {
  const hits = searchRules(query, rules).slice(0, k);
  return { hits, belowThreshold: hits.length === 0 || hits[0].score < RETRIEVAL_MIN_SCORE };
}

// ---- no-hallucination validator (mirror of validateAnswer.ts) ----

export const TD_NO_BASIS_RECOMMENDATION_VI =
  "Không đủ căn cứ rõ ràng để đưa khuyến nghị. Cần TD xác nhận trực tiếp tại bàn.";

export interface RawAnswer {
  recommendationVi?: string; citations?: Array<{ ruleId?: string }>;
  reasoningVi?: string; houseRuleOptionVi?: string; playerWordingVi?: string;
  confidence?: TdConfidence; needMoreInfoVi?: string[];
}

const RULE_NUM_RE = /(rule|quy tac|dieu|tda)\s*#?\s*(\d+)/g;

function numbersIn(text: string): Set<string> {
  const out = new Set<string>(); const norm = normalize(text);
  let m: RegExpExecArray | null; RULE_NUM_RE.lastIndex = 0;
  while ((m = RULE_NUM_RE.exec(norm)) !== null) out.add(m[2]);
  return out;
}
function allowedNumbers(rules: TdRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) { const m = r.citationLabel.match(/#?\s*(\d+)/); if (m) out.add(m[1]); }
  return out;
}
function noBasis(needMore: string[]): TdAnswer {
  return {
    source: "ai", isDemo: false, recommendationVi: TD_NO_BASIS_RECOMMENDATION_VI, citations: [],
    reasoningVi: "Không tìm thấy quy tắc phù hợp trong bộ luật đã tra. Trợ lý chỉ tư vấn dựa trên căn cứ truy hồi được — không suy đoán.",
    houseRuleOptionVi: "Ưu tiên luật CLB đã công bố và để TD/chủ CLB quyết định cuối cùng.",
    playerWordingVi: "Anh/chị cho em xin thêm chi tiết để em kiểm tra và mời TD xác nhận giúp mình nhé.",
    confidence: "low", needMoreInfoVi: needMore.length ? needMore : ["Mô tả rõ hơn tình huống tranh chấp."],
    matchedRuleIds: [],
  };
}

export function validateAnswer(raw: RawAnswer, retrieved: TdRule[]): TdAnswer {
  const byId = new Map(retrieved.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const validCitations: TdCitation[] = (raw.citations ?? [])
    .map((c) => (c.ruleId ? byId.get(c.ruleId) : undefined))
    .filter((r): r is TdRule => !!r)
    .map((r) => ({ ruleId: r.id, label: r.citationLabel, kind: r.citationKind }))
    .filter((c) => (seen.has(c.ruleId) ? false : seen.add(c.ruleId)));

  const needMore = (raw.needMoreInfoVi ?? []).filter((s) => s && s.trim());
  if (validCitations.length === 0) return noBasis(needMore);

  const prose = [raw.recommendationVi, raw.reasoningVi, raw.houseRuleOptionVi].filter(Boolean).join(" ");
  const allowed = allowedNumbers(retrieved);
  const fabricated = [...numbersIn(prose)].some((n) => !allowed.has(n));
  let confidence: TdConfidence = raw.confidence ?? "medium";
  if (fabricated) confidence = "low";

  return {
    source: "ai", isDemo: false,
    recommendationVi: (raw.recommendationVi ?? "").trim() || TD_NO_BASIS_RECOMMENDATION_VI,
    citations: validCitations,
    reasoningVi: (raw.reasoningVi ?? "").trim(),
    houseRuleOptionVi: (raw.houseRuleOptionVi ?? "").trim() || "Ưu tiên luật CLB đã công bố và để TD quyết định cuối cùng.",
    playerWordingVi: (raw.playerWordingVi ?? "").trim(),
    confidence,
    needMoreInfoVi: fabricated
      ? ["Mô hình có thể nhắc tới quy tắc ngoài căn cứ — TD kiểm tra kỹ trước khi áp dụng.", ...needMore]
      : needMore,
    matchedRuleIds: validCitations.map((c) => c.ruleId),
  };
}
