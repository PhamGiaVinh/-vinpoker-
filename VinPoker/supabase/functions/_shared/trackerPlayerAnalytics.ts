import { reduceHand } from "./trackerEngine/handState.ts";
import type { ActionRow, PlayerSeed, Street } from "./trackerEngine/types.ts";

export const TRACKER_PLAYER_ANALYTICS_VERSION = "tracker-player-analytics-v0";

export type TrackerAnalyticsMetricKey =
  | "vpip"
  | "pfr"
  | "threeBet"
  | "foldToThreeBet"
  | "fourBet"
  | "fiveBet"
  | "wtsd"
  | "wsd"
  | "wwsf"
  | "flopCbet"
  | "turnCbet"
  | "foldToCbet"
  | "checkRaise"
  | "aggressionFrequency";

export interface TrackerAnalyticsMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
  sampleSize: number;
  metricVersion: string;
}
export interface TrackerAnalyticsSettlementProof {
  verified: boolean;
  current: boolean;
  winnerPlayerIds: readonly string[];
  eligiblePlayerIds: readonly string[];
  showdown: boolean;
}

export interface TrackerAnalyticsHand {
  handId: string;
  status: string;
  isVoided: boolean;
  buttonSeat: number;
  boardCardCount: number;
  players: PlayerSeed[];
  actions: ActionRow[];
  settlement: TrackerAnalyticsSettlementProof | null;
}

export interface TrackerPlayerAnalyticsResult {
  metricVersion: string;
  handsObserved: number;
  proofCoverage: { verified: number; required: number };
  unavailableMetrics: TrackerAnalyticsMetricKey[];
  metrics: Record<TrackerAnalyticsMetricKey, TrackerAnalyticsMetric>;
}

type Counter = { numerator: number; denominator: number };

const POST_ACTIONS = new Set(["post_sb", "post_bb", "post_ante"]);
const AGGRESSIVE_ACTIONS = new Set(["bet", "raise", "all_in"]);

function metric(counter: Counter, available = true): TrackerAnalyticsMetric {
  if (!available) {
    return {
      numerator: 0,
      denominator: 0,
      percentage: null,
      sampleSize: 0,
      metricVersion: TRACKER_PLAYER_ANALYTICS_VERSION,
    };
  }
  return {
    ...counter,
    percentage: counter.denominator === 0
      ? null
      : Math.round((counter.numerator / counter.denominator) * 10_000) / 100,
    sampleSize: counter.denominator,
    metricVersion: TRACKER_PLAYER_ANALYTICS_VERSION,
  };
}

function ordered(actions: ActionRow[]): ActionRow[] {
  return [...actions].sort((left, right) => left.action_order - right.action_order);
}

function isFullAggression(
  hand: TrackerAnalyticsHand,
  prior: ActionRow[],
  action: ActionRow,
): { aggressive: boolean; full: boolean } {
  if (!AGGRESSIVE_ACTIONS.has(action.action_type)) return { aggressive: false, full: false };
  const runtime = reduceHand(hand.players, prior, hand.buttonSeat);
  const player = runtime.players.find((candidate) => candidate.player_id === action.player_id);
  if (!player) return { aggressive: false, full: false };
  const moved = Math.min(Math.max(0, action.action_amount), player.stack);
  const target = player.street_bet + moved;
  const increment = target - runtime.highestBet;
  const aggressive = increment > 0;
  const full = aggressive && increment >= runtime.minRaise;
  return { aggressive, full };
}

function foldedBefore(actions: ActionRow[], playerId: string, street: Street): boolean {
  const order: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
  const limit = order.indexOf(street);
  return actions.some((action) =>
    action.player_id === playerId
    && action.action_type === "fold"
    && order.indexOf(action.street) < limit
  );
}

function hasFolded(actions: ActionRow[], playerId: string): boolean {
  return actions.some((action) => action.player_id === playerId && action.action_type === "fold");
}

function postflopAggression(
  hand: TrackerAnalyticsHand,
  allActions: ActionRow[],
  action: ActionRow,
): boolean {
  const index = allActions.findIndex((candidate) => candidate === action);
  return isFullAggression(hand, allActions.slice(0, index), action).aggressive;
}

export function classifyTrackerPlayerAnalytics(
  playerId: string,
  inputHands: TrackerAnalyticsHand[],
): TrackerPlayerAnalyticsResult {
  const counters = Object.fromEntries([
    "vpip", "pfr", "threeBet", "foldToThreeBet", "fourBet", "fiveBet",
    "wtsd", "wsd", "wwsf", "flopCbet", "turnCbet", "foldToCbet",
    "checkRaise", "aggressionFrequency",
  ].map((key) => [key, { numerator: 0, denominator: 0 }])) as Record<TrackerAnalyticsMetricKey, Counter>;

  let handsObserved = 0;
  let proofRequired = 0;
  let proofVerified = 0;
  let wsdProofMissing = false;
  let wwsfProofMissing = false;

  for (const hand of inputHands) {
    if (hand.isVoided || hand.status !== "completed" || !hand.players.some((player) => player.player_id === playerId)) {
      continue;
    }
    handsObserved += 1;
    const actions = ordered(hand.actions);
    const preflop = actions.filter((action) => action.street === "preflop");
    counters.vpip.denominator += 1;
    counters.pfr.denominator += 1;
    if (preflop.some((action) => action.player_id === playerId && !POST_ACTIONS.has(action.action_type) && action.action_type !== "check" && action.action_type !== "fold")) {
      counters.vpip.numerator += 1;
    }

    let aggressionLevel = 0;
    let openerId: string | null = null;
    let targetPfr = false;
    const opportunitySeen = new Set<string>();
    const prior: ActionRow[] = [];
    for (const action of preflop) {
      if (POST_ACTIONS.has(action.action_type)) {
        prior.push(action);
        continue;
      }
      const before = aggressionLevel;
      const { aggressive, full } = isFullAggression(hand, prior, action);
      if (action.player_id === playerId) {
        if (aggressive) targetPfr = true;
        if (before === 1 && !opportunitySeen.has("threeBet")) {
          counters.threeBet.denominator += 1;
          opportunitySeen.add("threeBet");
          if (full) counters.threeBet.numerator += 1;
        }
        if (before === 2 && !opportunitySeen.has("fourBet")) {
          counters.fourBet.denominator += 1;
          opportunitySeen.add("fourBet");
          if (full) counters.fourBet.numerator += 1;
        }
        if (before === 3 && !opportunitySeen.has("fiveBet")) {
          counters.fiveBet.denominator += 1;
          opportunitySeen.add("fiveBet");
          if (full) counters.fiveBet.numerator += 1;
        }
        if (openerId === playerId && before >= 2 && !opportunitySeen.has("foldToThreeBet")) {
          counters.foldToThreeBet.denominator += 1;
          opportunitySeen.add("foldToThreeBet");
          if (action.action_type === "fold") counters.foldToThreeBet.numerator += 1;
        }
      }
      if (full) {
        aggressionLevel += 1;
        if (!openerId) openerId = action.player_id;
      }
      prior.push(action);
    }
    if (targetPfr) counters.pfr.numerator += 1;

    const sawFlop = hand.boardCardCount >= 3 && !foldedBefore(actions, playerId, "flop");
    const nonFolded = hand.players.filter((player) => !hasFolded(actions, player.player_id));
    const wentToShowdown = hand.boardCardCount === 5 && nonFolded.length >= 2 && !hasFolded(actions, playerId);
    if (sawFlop) {
      counters.wtsd.denominator += 1;
      if (wentToShowdown) counters.wtsd.numerator += 1;
      proofRequired += 1;
      const proof = hand.settlement;
      const proofCurrent = proof?.verified === true && proof.current === true;
      if (proofCurrent) proofVerified += 1;
      if (!proofCurrent) {
        wwsfProofMissing = true;
      } else {
        counters.wwsf.denominator += 1;
        if (proof!.winnerPlayerIds.includes(playerId)) counters.wwsf.numerator += 1;
      }
      if (wentToShowdown) {
        if (!proofCurrent || !proof!.showdown || !proof!.eligiblePlayerIds.includes(playerId)) {
          wsdProofMissing = true;
        } else {
          counters.wsd.denominator += 1;
          if (proof.winnerPlayerIds.includes(playerId)) counters.wsd.numerator += 1;
        }
      }
    }

    const fullAggressors = preflop.reduce<string[]>((result, action, index) => {
      const info = isFullAggression(hand, preflop.slice(0, index), action);
      return info.full ? [...result, action.player_id] : result;
    }, []);
    const preflopAggressor = fullAggressors.at(-1) ?? null;
    let madeFlopCbet = false;
    for (const street of ["flop", "turn"] as const) {
      const streetActions = actions.filter((action) => action.street === street);
      const actorExpected = street === "flop" ? preflopAggressor : madeFlopCbet ? playerId : null;
      if (actorExpected !== playerId || foldedBefore(actions, playerId, street)) continue;
      const actorIndex = streetActions.findIndex((action) => action.player_id === playerId);
      if (actorIndex < 0) continue;
      const priorStreet = streetActions.slice(0, actorIndex);
      if (priorStreet.some((action) => postflopAggression(hand, actions, action))) continue;
      const action = streetActions[actorIndex];
      const madeCbet = postflopAggression(hand, actions, action);
      const key = street === "flop" ? "flopCbet" : "turnCbet";
      counters[key].denominator += 1;
      if (madeCbet) counters[key].numerator += 1;
      if (street === "flop") madeFlopCbet = madeCbet;

      if (madeCbet) {
        const targetResponse = streetActions.slice(actorIndex + 1).find((candidate) => candidate.player_id === playerId);
        void targetResponse;
      }
    }

    for (const street of ["flop", "turn", "river"] as const) {
      const streetActions = actions.filter((action) => action.street === street);
      const cbetActor = street === "flop" ? preflopAggressor : null;
      if (cbetActor && cbetActor !== playerId) {
        const cbetIndex = streetActions.findIndex((action) =>
          action.player_id === cbetActor && postflopAggression(hand, actions, action)
        );
        const response = cbetIndex >= 0
          ? streetActions.slice(cbetIndex + 1).find((action) => action.player_id === playerId)
          : null;
        if (response) {
          counters.foldToCbet.denominator += 1;
          if (response.action_type === "fold") counters.foldToCbet.numerator += 1;
        }
      }

      const checkIndex = streetActions.findIndex((action) =>
        action.player_id === playerId && action.action_type === "check"
      );
      if (checkIndex >= 0) {
        const aggressionIndex = streetActions.findIndex((action, index) =>
          index > checkIndex && action.player_id !== playerId && postflopAggression(hand, actions, action)
        );
        const response = aggressionIndex >= 0
          ? streetActions.slice(aggressionIndex + 1).find((action) => action.player_id === playerId)
          : null;
        if (response) {
          counters.checkRaise.denominator += 1;
          if (postflopAggression(hand, actions, response)) counters.checkRaise.numerator += 1;
        }
      }
    }

    for (const action of actions.filter((candidate) => candidate.player_id === playerId && candidate.street !== "preflop")) {
      const aggressive = postflopAggression(hand, actions, action);
      if (aggressive) {
        counters.aggressionFrequency.numerator += 1;
        counters.aggressionFrequency.denominator += 1;
      } else if (["call", "fold"].includes(action.action_type)) {
        counters.aggressionFrequency.denominator += 1;
      }
    }
  }

  const unavailableMetrics: TrackerAnalyticsMetricKey[] = [];
  if (wsdProofMissing) unavailableMetrics.push("wsd");
  if (wwsfProofMissing) unavailableMetrics.push("wwsf");
  const metrics = Object.fromEntries(
    Object.entries(counters).map(([key, counter]) => [
      key,
      metric(counter, !unavailableMetrics.includes(key as TrackerAnalyticsMetricKey)),
    ]),
  ) as Record<TrackerAnalyticsMetricKey, TrackerAnalyticsMetric>;

  return {
    metricVersion: TRACKER_PLAYER_ANALYTICS_VERSION,
    handsObserved,
    proofCoverage: { verified: proofVerified, required: proofRequired },
    unavailableMetrics,
    metrics,
  };
}
