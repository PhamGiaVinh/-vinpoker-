import type { TdRule } from "./types";
import { MOCK_TD_RULES } from "./mockRules";
import { ADVISORY_RULES } from "./advisoryRules";

// ⚠️ NON-AUTHORITATIVE CORPUS — table rulings (paraphrased TDA-topic summaries)
// + club house rules + operations/floor/strategy advisory entries. This is NOT
// the official TDA 2024 text and the "#NN" labels are topic placeholders, not
// real rule numbers. Upgrading to official sourced text = replacing the ruling
// entries with source:"tda" + verbatim text + provenance; the TdRule shape and
// everything downstream stay the same.
//
// buildIndex.ts serializes this into rules-index.json (committed to the edge
// function dir) so the real AI assistant and the offline fallback share one
// corpus. Regenerate after editing:
//   REGEN=1 npx vitest run src/lib/tdai/rulesIndex.test.ts

export const CORPUS_VERSION = "house-2024-v2.0-advisory";

// PR D mock rules, re-labelled as TDA-topic *summaries* (not "placeholder").
// They are table rulings → category "ruling".
const TDA_SUMMARIES: TdRule[] = MOCK_TD_RULES.map((r) => ({
  ...r,
  source: "summary",
  citationKind: "tda_summary",
  citationLabel: r.citationLabel.replace("TDA placeholder", "Tóm tắt TDA"),
  category: "ruling",
}));

// Club house rules (paraphrased, advisory — clearly club policy, not TDA).
const HOUSE_RULES: TdRule[] = [
  {
    id: "house-phone-at-table",
    topicEn: "Phones / devices at the table",
    topicVi: "Điện thoại / thiết bị tại bàn",
    summaryEn: "Club policy: no calls at the table during a live hand; a player in a hand may be asked to step away or fold if disruptive.",
    summaryVi: "Luật CLB: không nghe gọi tại bàn khi đang trong ván bài; người đang trong ván nếu gây ảnh hưởng có thể được mời ra ngoài hoặc xử lý theo luật CLB.",
    keywords: ["điện thoại", "phone", "thiết bị", "device", "nghe gọi", "phone at table"],
    suggestionVi: "Nhắc nhở lần đầu; nếu tái phạm hoặc gây ảnh hưởng ván bài, áp dụng luật CLB — TD xác nhận.",
    playerWordingVi: "Anh/chị vui lòng không nghe gọi tại bàn khi đang trong ván. Nếu cần, anh/chị ra ngoài giúp em nhé.",
    citationLabel: "LUẬT CLB",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "house-clock-call",
    topicEn: "Calling the clock",
    topicVi: "Gọi giờ (clock call)",
    summaryEn: "House procedure: once the clock is called and approved, the player gets a fixed count; failing to act in time results in a fold (or check if no bet).",
    summaryVi: "Quy trình CLB: khi giờ được gọi và chấp thuận, người chơi có một khoảng đếm cố định; hết giờ mà chưa hành động thì bị xử fold (hoặc check nếu không có cược).",
    keywords: ["clock call", "gọi giờ", "đếm giờ", "time", "call the clock", "hết giờ"],
    suggestionVi: "Cấp số đếm cố định theo luật CLB; hết giờ chưa hành động → fold (hoặc check nếu không có cược) — TD xác nhận.",
    playerWordingVi: "Bàn đã gọi giờ. Em xin phép đếm theo quy định; nếu hết giờ mà anh/chị chưa quyết định thì bài sẽ được xử theo luật CLB.",
    citationLabel: "LUẬT CLB",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "house-penalty",
    topicEn: "Penalties",
    topicVi: "Án phạt (penalty)",
    summaryEn: "House escalation: warning → one-round/one-hand sit-out → time penalty, at the TD's discretion based on severity and history.",
    summaryVi: "Mức phạt CLB tăng dần: nhắc nhở → ngồi ngoài một vòng/một ván → phạt thời gian, do TD quyết định theo mức độ và tiền sử vi phạm.",
    keywords: ["penalty", "án phạt", "phạt", "warning", "nhắc nhở", "ngồi ngoài", "time penalty"],
    suggestionVi: "Áp dụng thang phạt CLB theo mức độ; ghi nhận và để TD quyết định mức cụ thể.",
    playerWordingVi: "Trường hợp này em xin áp dụng mức nhắc nhở/ngồi ngoài theo luật CLB. Mức phạt cụ thể do TD quyết định ạ.",
    citationLabel: "LUẬT CLB",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
];

export const TD_RULES_CORPUS: TdRule[] = [...TDA_SUMMARIES, ...HOUSE_RULES, ...ADVISORY_RULES];
