// GTO Wizard Open Range — 50bb 8-max ChipEV (approx, majority action per hand)
// Data derived from GTO Wizard screenshots. Cells not listed = fold.
export type GTOAction = "allin" | "raise" | "call" | "fold";
export type GTOPosition = "UTG" | "UTG1" | "LJ" | "HJ" | "CO" | "BTN" | "SB";

const GTO_POSITIONS: GTOPosition[] = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB"];

// Raise size labels per position
export const RAISE_SIZE: Record<GTOPosition, string> = {
  UTG: "2.3", UTG1: "2.3", LJ: "2.3", HJ: "2.3", CO: "2.3", BTN: "2.3", SB: "3.5",
};

type Map = Record<string, GTOAction>;
const r = (hands: string[]): Map => Object.fromEntries(hands.map((h) => [h, "raise" as GTOAction]));
const merge = (...maps: Map[]): Map => Object.assign({}, ...maps);

// UTG ~17.7% (img2: UTG selected)
const UTG = r([
  "AA","KK","QQ","JJ","TT","99","88","77","66","55",
  "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
  "KQs","KJs","KTs","K9s","K8s","K7s",
  "QJs","QTs","Q9s","Q8s",
  "JTs","J9s","J8s",
  "T9s","T8s","98s","87s","76s","65s","54s",
  "AKo","AQo","AJo","ATo","KQo",
]);

// UTG1 ~20.4% (img1/img3)
const UTG1 = merge(UTG, r([
  "44","33","22","K6s","Q7s","J7s","T7s","97s","86s","75s","64s","53s","KJo",
]));

// LJ ~24.9% (img4)
const LJ = merge(UTG1, r([
  "K5s","Q6s","J6s","T6s","96s","85s","74s","63s","52s","43s","KTo","QJo",
]));

// HJ ~29.6% (img5)
const HJ = merge(LJ, r([
  "K4s","K3s","K2s","Q5s","Q4s","Q3s","J5s","J4s",
  "ATo","K9o","QTo","JTo",
]));

// CO ~37.6% (img6)
const CO = merge(HJ, r([
  "Q2s","J3s","J2s","T5s","T4s","T3s","T2s","95s","94s","84s",
  "A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o",
  "K8o","K7o","Q9o","J9o","T9o",
]));

// BTN ~54% (img7)
const BTN = merge(CO, r([
  "93s","92s","83s","82s","73s","72s","62s","42s","32s",
  "K6o","K5o","K4o","K3o","K2o",
  "Q8o","Q7o","Q6o","Q5o",
  "J8o","J7o","J6o",
  "T8o","T7o","98o","97o","87o","76o","65o",
]));

// SB ~83.3% non-fold (img8): Raise 3.5 ~21.7% + Call ~61.7%
// Premium hands raise, suited broadway/connectors raise, others mostly call
const SB_RAISE = r([
  "AA","KK","QQ","JJ","TT","99",
  "AKs","AQs","AJs","ATs","A5s","A4s",
  "KQs","KJs","KTs",
  "QJs","QTs","JTs",
  "T9s","98s","87s","76s","65s","54s",
  "AKo","AQo","AJo",
]);
// SB Call: very wide — almost everything else except trash offsuit
const SB_CALL: Map = Object.fromEntries(
  [
    "88","77","66","55","44","33","22",
    "A9s","A8s","A7s","A6s","A3s","A2s",
    "K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s",
    "Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s",
    "J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s",
    "T8s","T7s","T6s","T5s","T4s","T3s","T2s",
    "97s","96s","95s","94s","93s","92s",
    "86s","85s","84s","83s","82s",
    "75s","74s","73s","72s",
    "64s","63s","62s",
    "53s","52s","43s","42s","32s",
    "ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o",
    "KQo","KJo","KTo","K9o","K8o","K7o","K6o","K5o",
    "QJo","QTo","Q9o","Q8o","Q7o",
    "JTo","J9o","J8o","J7o",
    "T9o","T8o","T7o","98o","97o","87o","76o","65o","54o",
  ].map((h) => [h, "call" as GTOAction]),
);
const SB = merge(SB_CALL, SB_RAISE);

// Remap theo yêu cầu user (range chart đang gán sai vị trí):
//   BTN  ← CO  (range hiện tại của CO mới đúng cho BTN)
//   SB   ← BTN (range hiện tại của BTN mới đúng cho SB)
//   UTG1 ← SB  (range hiện tại của SB mới đúng cho UTG1)
//   LJ   ← UTG1
//   HJ   ← LJ
//   CO   ← HJ
//   UTG  giữ nguyên
export const OPEN_RANGE_50BB: Record<GTOPosition, Map> = {
  UTG,
  UTG1: SB,
  LJ:   UTG1,
  HJ:   LJ,
  CO:   HJ,
  BTN:  CO,
  SB:   CO, // SB hiển thị chart giống BTN (CO-original)
};

function actionOf(pos: GTOPosition, hand: string): GTOAction {
  return OPEN_RANGE_50BB[pos][hand] ?? "fold";
}
