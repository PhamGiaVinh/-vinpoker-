import { reduceHand, type ActionRow } from "../../../src/lib/tracker-poker/handStateCore.ts";

type PayoutItem = {
  fromPlace: number;
  toPlace: number;
  amountPerPlayer: number;
  playerName: string | null;
  avatarUrl: string | null;
  resultStatus: "official" | "open";
};

export function reducePublicSpectatorPayload(component: string, payload: unknown): unknown {
  if (component === "tables" && isRecord(payload) && Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(reduceLiveTable) };
  }
  if (component !== "payout" || !isRecord(payload) || !Array.isArray(payload.items)) return payload;
  const rows = payload.items.filter(isPayoutItem).sort((a, b) => a.fromPlace - b.fromPlace);
  const grouped: PayoutItem[] = [];
  for (const row of rows) {
    const previous = grouped.at(-1);
    if (previous && previous.resultStatus === "open" && row.resultStatus === "open" && previous.amountPerPlayer === row.amountPerPlayer && previous.toPlace + 1 === row.fromPlace) {
      previous.toPlace = row.toPlace;
    } else grouped.push({ ...row });
  }
  return { ...payload, items: grouped };
}

// Presentation only: replay the existing canonical reducer. Never settle a pot
// or write the resulting stacks back to the business tables.
function reduceLiveTable(value: unknown): unknown {
  if (!isRecord(value) || value.trackerState !== "live") return value;
  const { actions, ...table } = value;
  const players = Array.isArray(table.players) ? table.players.filter(isRecord) : [];
  const key = (row: Record<string, unknown>) => `${row.playerId}:${row.entryNumber}`;
  const unknown = () => ({ ...table, pot: null, players: players.map((p) => ({ ...p, stack: null })) });
  if (!players.length || !Array.isArray(actions) || players.some((p) =>
    !Number.isSafeInteger(p.startingStack) || Number(p.startingStack) < 0 || !Number.isInteger(p.entryNumber))) return unknown();
  const identities = new Set(players.map(key));
  if (identities.size !== players.length) return unknown();
  const canonical: ActionRow[] = [];
  for (const action of actions) {
    if (!isRecord(action) || !identities.has(key(action)) || !Number.isSafeInteger(action.amount)
      || Number(action.amount) < 0 || !Number.isInteger(action.order)
      || !["preflop", "flop", "turn", "river", "showdown"].includes(String(action.street))
      || !["fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"].includes(String(action.actionType))) return unknown();
    canonical.push({ player_id: key(action), street: action.street as ActionRow["street"],
      action_type: action.actionType as ActionRow["action_type"], action_amount: Number(action.amount), action_order: Number(action.order) });
  }
  const runtime = reduceHand(players.map((p) => ({ player_id: key(p), seat_number: Number(p.seatNumber),
    starting_stack: Number(p.startingStack) })), canonical, Number(table.buttonSeat) || 0);
  const byIdentity = new Map(runtime.players.map((p) => [p.player_id, p]));
  return { ...table, pot: runtime.players.reduce((total, p) => total + p.total_bet, 0),
    players: players.map((p) => ({ ...p, stack: byIdentity.get(key(p))?.stack ?? null })) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPayoutItem(value: unknown): value is PayoutItem {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.fromPlace) && Number.isInteger(value.toPlace) && typeof value.amountPerPlayer === "number"
    && (value.resultStatus === "official" || value.resultStatus === "open");
}
