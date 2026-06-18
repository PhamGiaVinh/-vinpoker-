// Operator action log (engine mode) — pure presentational extraction of the
// inline action-log block in HandInputPanel. Groups recorded actions by street
// with the board cards shown per street header. The MANUAL branch keeps its own
// inline copy byte-identical; this component is rendered only in the engine path.

import { type Card, displayCard } from "@/components/shared/CardSlotPicker";

type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface LogAction {
  street: Street;
  display_name: string;
  seat_number: number;
  action_type: string;
  amount: number;
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABELS: Record<Street, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function formatActionLabel(a: LogAction): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const type = a.action_type;
  if (type === "fold") return "Fold";
  if (type === "check") return "Check";
  if (type === "call") return `Call ${fmt(a.amount)}`;
  if (type === "bet") return `Bet ${fmt(a.amount)}`;
  if (type === "raise") return `Raise ${fmt(a.amount)}`;
  if (type === "all_in") return `All-In ${fmt(a.amount)}`;
  if (type === "post_sb") return `SB ${fmt(a.amount)}`;
  if (type === "post_bb") return `BB ${fmt(a.amount)}`;
  if (type === "post_ante") return `Ante ${fmt(a.amount)}`;
  return `${type} ${fmt(a.amount)}`;
}

interface OperatorActionLogProps {
  actions: LogAction[];
  communityCards: (Card | null)[];
}

export function OperatorActionLog({ actions, communityCards }: OperatorActionLogProps) {
  return (
    <div className="bg-card border border-border/30 rounded-lg p-2.5 shadow-sm max-h-60 flex flex-col">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 sticky top-0 bg-card pb-2 border-b border-border/20">
        Nhật ký thao tác
      </div>
      <div className="overflow-y-auto space-y-0.5 flex-1 pr-1">
        {actions.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4 italic">Chưa có action nào được ghi nhận</div>
        )}
        {STREET_ORDER.filter((s) => actions.some((a) => a.street === s)).map((street) => (
          <div key={street} className="mb-3">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1 sticky top-0 bg-card/50 backdrop-blur-sm py-1">
              {STREET_LABELS[street]}
              {street === "flop" && communityCards[0] && (
                <span className="text-muted-foreground font-normal ml-2">({communityCards.slice(0, 3).filter(Boolean).map((c) => displayCard(c as Card)).join(" ")})</span>
              )}
              {street === "turn" && communityCards[3] && (
                <span className="text-muted-foreground font-normal ml-2">({displayCard(communityCards[3]!)})</span>
              )}
              {street === "river" && communityCards[4] && (
                <span className="text-muted-foreground font-normal ml-2">({displayCard(communityCards[4]!)})</span>
              )}
            </div>
            {actions.filter((a) => a.street === street).map((action, idx) => (
              <div key={idx} className="flex justify-between py-1.5 px-2 border-b border-border/10 last:border-0 text-xs hover:bg-secondary/30 rounded transition-colors">
                <span className="text-muted-foreground font-medium">
                  <span className="text-[10px] text-foreground bg-border/30 px-1 rounded mr-1">S{action.seat_number}</span>
                  {action.display_name}
                </span>
                <span className={`font-bold ${action.amount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{formatActionLabel(action)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
