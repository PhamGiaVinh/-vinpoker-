import type {
  ParsedVoiceBoardCommand,
  VoiceBoardProposal,
  VoiceProposalContext,
  VoiceRejectedProposal,
} from "./types";

function reject(code: VoiceRejectedProposal["code"], message: string): VoiceRejectedProposal {
  return { ok: false, command: null, code, message };
}

/** Creates a UI-only Board draft. It never writes Board slots or state. */
export function resolveVoiceBoardProposal(
  command: ParsedVoiceBoardCommand,
  context: VoiceProposalContext,
): VoiceBoardProposal | VoiceRejectedProposal {
  if (!context.handStarted || !context.handId) return reject("no_active_hand", "Bàn chưa có hand đang chạy.");
  if (context.readOnly) return reject("read_only", "Phiên này chỉ được xem.");
  if (context.syncBlocked) return reject("sync_blocked", "Trạng thái bàn chưa đồng bộ.");
  if (context.correctionPending) return reject("correction_pending", "Đang chờ Floor sửa action trước đó.");
  const expectedWorkflowState = command.street === "flop" ? "enter_flop"
    : command.street === "turn" ? "enter_turn" : "enter_river";
  if (context.workflowState !== expectedWorkflowState) {
    return reject("wrong_workflow", "Chưa tới bước nhập Board này.");
  }
  const persistedBoardCards = context.persistedBoardCards ?? [];
  const expectedExistingBoardCount = command.street === "flop" ? 0
    : command.street === "turn" ? 3 : 4;
  if (persistedBoardCards.length !== expectedExistingBoardCount) {
    return reject("board_already_persisted", "Board server đã thay đổi. Hãy tải lại hoặc dùng luồng sửa thủ công.");
  }
  const cumulativeCards = [...persistedBoardCards, ...command.newCards];
  if (new Set(cumulativeCards).size !== cumulativeCards.length) {
    return reject("duplicate_card", "Board đề xuất có lá trùng với Board đã xác nhận.");
  }
  return {
    ok: true,
    intentDomain: "board",
    command,
    expectedStateVersion: context.expectedStateVersion,
    expectedWorkflowState,
    expectedStreet: command.street,
    expectedExistingBoardCount,
    persistedBoardCards,
    cumulativeCards,
  };
}
