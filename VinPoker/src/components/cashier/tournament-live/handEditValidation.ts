import {
  actorViewFromRuntime,
  nextToActAtStreet,
  reduceHandAtStreet,
  type ActionRow,
  type PlayerSeed,
  type Street,
  type TrackerActionType,
} from "@/lib/tracker-poker/handStateCore";

import type { EditAction } from "./handEditDiff";

export interface HandEditValidationPlayer extends PlayerSeed {
  display_name: string;
}

export interface HandEditActionAssessment {
  action_order: number;
  action_type: string;
  player_id: string;
  legal: boolean;
  requiredAmount: number | null;
  minimumAmount: number | null;
  stackBefore: number | null;
  message: string;
}

export interface HandEditValidation {
  ok: boolean;
  potSize: number;
  assessments: HandEditActionAssessment[];
  status: "INCOMPLETE" | "INVALID" | "READY_TO_APPLY";
  nextAction: {
    player_id: string;
    street: Street;
    action_type: "check" | "call";
    action_amount: number;
    action_order: number;
  } | null;
}

const STREETS = new Set<Street>(["preflop", "flop", "turn", "river", "showdown"]);
const ACTION_TYPES = new Set<TrackerActionType>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);
const POSTING_TYPES = new Set<TrackerActionType>(["post_sb", "post_bb", "post_ante"]);

function chips(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function assessment(
  action: EditAction,
  legal: boolean,
  message: string,
  requiredAmount: number | null,
  minimumAmount: number | null,
  stackBefore: number | null,
): HandEditActionAssessment {
  return {
    action_order: action.action_order,
    action_type: action.action_type,
    player_id: action.player_id,
    legal,
    message,
    requiredAmount,
    minimumAmount,
    stackBefore,
  };
}

/**
 * Advisory validation for the completed-hand editor. It uses the same shared
 * browser/Edge reducer for amounts and turn order; writers still revalidate on
 * the server before a correction can persist.
 */
export function validateHandEditActions(
  players: HandEditValidationPlayer[],
  actions: EditAction[],
  buttonSeat: number,
): HandEditValidation {
  const seeds = players.map(({ player_id, seat_number, starting_stack }) => ({ player_id, seat_number, starting_stack }));
  const knownPlayers = new Map(players.map((player) => [player.player_id, player]));
  const sorted = [...actions].sort((left, right) => left.action_order - right.action_order);
  const accepted: ActionRow[] = [];
  const assessments: HandEditActionAssessment[] = [];
  let priorStreetIndex = -1;

  for (const action of sorted) {
    const player = knownPlayers.get(action.player_id);
    const amount = chips(action.action_amount);
    const street = STREETS.has(action.street as Street) ? action.street as Street : null;
    const actionType = ACTION_TYPES.has(action.action_type as TrackerActionType)
      ? action.action_type as TrackerActionType
      : null;

    if (!player) {
      assessments.push(assessment(action, false, "Người chơi không thuộc hand này.", null, null, null));
      continue;
    }
    if (!street || !actionType || amount === null) {
      assessments.push(assessment(action, false, "Street, loại action hoặc số chip không hợp lệ.", null, null, null));
      continue;
    }

    const streetIndex = ["preflop", "flop", "turn", "river", "showdown"].indexOf(street);
    if (streetIndex < priorStreetIndex) {
      assessments.push(assessment(action, false, "Không thể quay lại street trước đó.", null, null, null));
      continue;
    }

    const runtime = reduceHandAtStreet(seeds, accepted, buttonSeat, street);
    const actor = runtime.players.find((candidate) => candidate.player_id === action.player_id);
    if (!actor) {
      assessments.push(assessment(action, false, "Không dựng được trạng thái người chơi.", null, null, null));
      continue;
    }
    const view = actorViewFromRuntime(runtime, action.player_id);
    const expectedActor = nextToActAtStreet(seeds, accepted, buttonSeat, street);
    const amountWithinStack = amount <= actor.stack;
    const actionRow: ActionRow = {
      player_id: action.player_id,
      street,
      action_type: actionType,
      action_amount: amount,
      action_order: action.action_order,
    };

    if (POSTING_TYPES.has(actionType)) {
      const validPosting = amount > 0 && amountWithinStack;
      assessments.push(assessment(
        action,
        validPosting,
        validPosting ? "Blind/ante hợp lệ theo stack trước action." : "Blind/ante phải lớn hơn 0 và không vượt stack.",
        null,
        null,
        actor.stack,
      ));
      if (validPosting) {
        accepted.push(actionRow);
        priorStreetIndex = Math.max(priorStreetIndex, streetIndex);
      }
      continue;
    }

    if (expectedActor !== action.player_id) {
      assessments.push(assessment(action, false, "Sai thứ tự lượt theo trạng thái dựng lại.", null, null, actor.stack));
      continue;
    }

    let valid = amountWithinStack;
    let message = "";
    let requiredAmount: number | null = null;
    let minimumAmount: number | null = null;

    switch (actionType) {
      case "fold":
        valid = valid && view.legal.fold && amount === 0;
        message = valid ? "Fold hợp lệ." : "Fold không có số chip và phải đúng lượt.";
        break;
      case "check":
        valid = valid && view.legal.check && amount === 0;
        message = valid ? "Check hợp lệ." : "Chỉ check khi không còn chip cần theo.";
        break;
      case "call":
        requiredAmount = view.toCall;
        valid = valid && view.legal.call && amount === view.toCall;
        message = valid ? `Call hợp lệ: thêm ${view.toCall.toLocaleString("vi-VN")}.` : `Call phải thêm đúng ${view.toCall.toLocaleString("vi-VN")}.`;
        break;
      case "bet":
        minimumAmount = Math.min(actor.stack, runtime.minRaise);
        valid = valid && view.legal.bet && amount >= minimumAmount && amount > 0;
        message = valid ? `Bet hợp lệ: thêm ${amount.toLocaleString("vi-VN")}.` : `Bet phải ít nhất ${minimumAmount.toLocaleString("vi-VN")} hoặc dùng all-in.`;
        break;
      case "raise": {
        const neededToCall = view.toCall;
        const minTotal = view.minRaiseTo;
        const raiseTo = actor.street_bet + amount;
        requiredAmount = neededToCall;
        minimumAmount = Math.min(actor.stack, Math.max(neededToCall, minTotal - actor.street_bet));
        const isShortAllIn = amount === actor.stack && raiseTo > runtime.highestBet;
        valid = valid && view.legal.raise && raiseTo > runtime.highestBet && (raiseTo >= minTotal || isShortAllIn);
        message = valid
          ? `Raise hợp lệ: thêm ${amount.toLocaleString("vi-VN")}, raise-to ${raiseTo.toLocaleString("vi-VN")}.`
          : `Raise cần tối thiểu thêm ${minimumAmount.toLocaleString("vi-VN")} (raise-to ${minTotal.toLocaleString("vi-VN")}) hoặc all-in ngắn.`;
        break;
      }
      case "all_in":
        requiredAmount = actor.stack;
        valid = valid && view.legal.allIn && amount === actor.stack && amount > 0;
        message = valid ? `All-in hợp lệ: thêm toàn bộ ${actor.stack.toLocaleString("vi-VN")}.` : `All-in phải đúng toàn bộ stack còn ${actor.stack.toLocaleString("vi-VN")}.`;
        break;
    }

    assessments.push(assessment(action, valid, message, requiredAmount, minimumAmount, actor.stack));
    if (valid) {
      accepted.push(actionRow);
      priorStreetIndex = Math.max(priorStreetIndex, streetIndex);
    }
  }

  const currentStreet = accepted.length > 0 ? accepted[accepted.length - 1].street : "preflop";
  const runtime = reduceHandAtStreet(seeds, accepted, buttonSeat, currentStreet);
  const validPrefix = assessments.every((item) => item.legal);
  const nextActorId = validPrefix ? nextToActAtStreet(seeds, accepted, buttonSeat, currentStreet) : null;
  const nextView = nextActorId ? actorViewFromRuntime(runtime, nextActorId) : null;
  const livePlayers = runtime.players.filter((player) => !player.is_folded);
  const terminal = livePlayers.length <= 1
    || ((currentStreet === "river" || currentStreet === "showdown") && nextActorId === null);
  const status = !validPrefix ? "INVALID" : terminal ? "READY_TO_APPLY" : "INCOMPLETE";
  return {
    ok: validPrefix,
    potSize: runtime.players.reduce((sum, player) => sum + player.total_bet, 0),
    assessments,
    status,
    nextAction: nextActorId && nextView ? {
      player_id: nextActorId,
      street: currentStreet,
      action_type: nextView.toCall > 0 ? "call" : "check",
      action_amount: nextView.toCall,
      action_order: Math.max(0, ...sorted.map((action) => action.action_order)) + 1,
    } : null,
  };
}
