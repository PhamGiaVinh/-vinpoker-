import type { TdRule } from "./types";

// Pure, offline keyword search over the DEMO rule set. No network, no Supabase,
// no LLM. Diacritic-insensitive Vietnamese matching + a small vi↔en synonym
// map so an English keyword finds a Vietnamese rule and vice-versa. This is
// exactly the offline-fallback path the real PR E assistant degrades to.

/** Lowercase, strip Vietnamese diacritics, đ→d, keep alphanumerics + spaces. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "is", "on", "and", "or", "it", "for",
  "khi", "la", "co", "va", "cua", "mot", "cho", "voi", "bi", "da", "thi", "nay",
  "anh", "chi", "em", "ban", "nguoi",
]);

function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Synonym groups (already normalized). If the query contains ANY phrase in a
// group, every group phrase's tokens are added as query terms. Bridges vi↔en.
const SYNONYM_GROUPS: string[][] = [
  ["string bet", "dat cuoc chuoi", "cuoc chuoi", "chuoi chip"],
  ["out of turn", "sai luot", "hanh dong sai luot", "khong dung luot", "act early"],
  ["exposed card", "bai lo", "lo bai", "lat bai", "show bai"],
  ["verbal", "tuyen bo", "noi mieng", "tuyen bo mieng", "declaration"],
  ["kill", "muck", "huy bai", "bo bai", "bai thang", "winning hand"],
  ["odd chip", "chip le", "le chip", "split pot", "chia pot", "chip du"],
  ["misdeal", "chia bai loi", "chia loi", "loi chia bai", "redeal", "chia lai"],
  ["all in", "to het", "side pot", "hu phu", "pot phu", "hu chinh"],
  ["wrong seat", "sai ghe", "ngoi sai", "ghe sai", "sai vi tri"],
  ["premature", "board card", "bai chung", "lat som", "flop som", "turn som", "river som"],
  ["away", "roi ban", "vang mat", "khong co mat", "absent", "roi ghe"],
  ["unclear raise", "raise khong ro", "muc raise", "ambiguous", "mo ho", "raise map mo"],
  // operations
  ["co cau mu", "cau truc mu", "blind structure", "do dai level", "nhay mu", "tang mu", "buoc nhay mu"],
  ["gom chip", "color up", "colorup", "dua chip", "chip race", "doi chip"],
  ["can ban", "table balance", "balancing", "chuyen ban can", "don ban"],
  ["gop ban", "break table", "dap ban", "pha ban", "redraw", "rai nguoi"],
  ["dang ky muon", "late reg", "late registration", "re entry", "reentry", "tai dang ky"],
  ["payout", "tra thuong", "co cau giai thuong", "icm", "chia tien", "chip chop", "deal ban chung ket"],
  ["big blind ante", "bb ante", "ante chung"],
  ["boc ghe", "seat draw", "random seat", "xep ghe ngau nhien"],
  ["dong ho giai", "tournament clock", "lich nghi", "break giai lao", "gio nghi", "dinner break"],
  // floor procedure / incidents
  ["day pot nham", "chung nham", "trao pot sai", "wrong pot", "dem pot sai"],
  ["lech chip", "chip discrepancy", "sai so chip", "thieu chip", "du chip", "chip khong khop"],
  ["thong dong", "collusion", "nuong tay", "soft play", "softplay", "chuyen chip", "chip dumping"],
  ["tieu xao", "angle", "angle shoot", "angleshooting", "gia vo bo bai"],
  ["ghi nhan su viec", "incident", "bien ban", "log su viec", "luu su viec"],
  // strategy
  ["vi tri", "position", "range mo", "opening range", "early position", "late position", "nut bai button"],
  ["pot odds", "ti le pot", "equity", "dem outs"],
  ["bong bong", "bubble", "ap luc bubble", "moc nhay thuong", "pay jump"],
  ["short stack", "stack ngan", "push fold", "stack sau", "deep stack"],
  ["3bet", "3 bet", "re raise", "tai cuoc", "4bet", "4 bet", "raise lai"],
  ["bankroll", "quan ly von", "variance", "phuong sai", "downswing", "chuoi thua"],
];

/** Expand query tokens with synonym-group tokens for any matched group phrase. */
function expandQueryTerms(normalizedQuery: string): Set<string> {
  const terms = new Set(tokenize(normalizedQuery));
  for (const group of SYNONYM_GROUPS) {
    const hit = group.some((phrase) => normalizedQuery.includes(phrase));
    if (hit) {
      for (const phrase of group) {
        for (const tok of tokenize(phrase)) terms.add(tok);
      }
    }
  }
  return terms;
}

function ruleZones(rule: TdRule): { keywordTokens: Set<string>; topicTokens: Set<string>; summaryTokens: Set<string> } {
  const kw = new Set<string>();
  for (const k of rule.keywords) for (const tok of tokenize(normalize(k))) kw.add(tok);
  const topic = new Set(tokenize(normalize(`${rule.topicEn} ${rule.topicVi}`)));
  const summary = new Set(tokenize(normalize(`${rule.summaryEn} ${rule.summaryVi}`)));
  return { keywordTokens: kw, topicTokens: topic, summaryTokens: summary };
}

export interface TdSearchHit {
  rule: TdRule;
  score: number;
}

const W_KEYWORD = 3;
const W_TOPIC = 2;
const W_SUMMARY = 1;
// A lone single summary-word overlap (score 1) is noise — diacritic stripping
// collapses distinct words (e.g. "tối" and "tới" both → "toi"). Require at
// least a keyword(3), a topic(2), or two summary words to count as a hit.
const MIN_HIT_SCORE = 2;

/**
 * Rank rules against a free-text query. Returns hits with score > 0, highest
 * first. Weighted by zone: keyword(3) > topic(2) > summary(1). Pure & sync.
 */
export function searchRules(query: string, rules: TdRule[] = []): TdSearchHit[] {
  const terms = expandQueryTerms(normalize(query));
  if (terms.size === 0) return [];

  const hits: TdSearchHit[] = [];
  for (const rule of rules) {
    const z = ruleZones(rule);
    let score = 0;
    for (const t of terms) {
      if (z.keywordTokens.has(t)) score += W_KEYWORD;
      else if (z.topicTokens.has(t)) score += W_TOPIC;
      else if (z.summaryTokens.has(t)) score += W_SUMMARY;
    }
    if (score >= MIN_HIT_SCORE) hits.push({ rule, score });
  }
  hits.sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id));
  return hits;
}
