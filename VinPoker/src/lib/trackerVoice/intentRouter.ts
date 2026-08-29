import type { TrackerWorkflowState } from "@/components/cashier/tournament-live/handinput/trackerWorkflow";
import { parseTrackerVoiceCommandCore, type TrackerVoiceAmountOptions } from "./parserCore";
import { parseVoiceBoardCommand } from "./boardParser";
import type { ParsedVoiceBoardCommand } from "./types";

export type TrackerVoiceIntentRoute =
  | { ok: true; intentDomain: "action"; command: NonNullable<ReturnType<typeof parseTrackerVoiceCommandCore>> }
  | { ok: true; intentDomain: "board"; command: ParsedVoiceBoardCommand }
  | { ok: false; code: "command_not_supported" | "intent_ambiguous" | "wrong_workflow" };

/**
 * Domains are parsed independently. Never try Board only because Action
 * validation failed: that fallback would trust a client-selected domain.
 */
export function routeTrackerVoiceIntent(
  rawTranscript: string,
  workflowState: TrackerWorkflowState,
  amountOptions: TrackerVoiceAmountOptions = {},
): TrackerVoiceIntentRoute {
  const action = parseTrackerVoiceCommandCore(rawTranscript, amountOptions);
  const board = parseVoiceBoardCommand(rawTranscript);
  const candidates = [
    ...(action ? [{ intentDomain: "action" as const, command: action }] : []),
    ...(board ? [{ intentDomain: "board" as const, command: board }] : []),
  ];
  if (candidates.length === 0) return { ok: false, code: "command_not_supported" };
  if (candidates.length > 1) return { ok: false, code: "intent_ambiguous" };
  const selected = candidates[0];
  const actionAllowed = workflowState === "preflop_action"
    || workflowState === "flop_action"
    || workflowState === "turn_action"
    || workflowState === "river_action";
  const boardAllowed = (selected.intentDomain === "board" && (
    (selected.command.street === "flop" && workflowState === "enter_flop")
    || (selected.command.street === "turn" && workflowState === "enter_turn")
    || (selected.command.street === "river" && workflowState === "enter_river")
  ));
  const controls = selected.intentDomain === "action"
    && (selected.command.kind === "report_wrong_action" || selected.command.kind === "call_floor");
  if (!(controls || (selected.intentDomain === "action" && actionAllowed) || boardAllowed)) {
    return { ok: false, code: "wrong_workflow" };
  }
  return { ok: true, ...selected };
}
