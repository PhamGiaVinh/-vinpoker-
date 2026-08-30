import type { ParsedVoiceFinishCommand, VoiceFinishProposal, VoiceFinishProposalContext, VoiceRejectedProposal } from "./types";

function reject(code: VoiceRejectedProposal["code"], message: string): VoiceRejectedProposal {
  return { ok: false, command: null, code, message };
}

/** The server fills the settlement summary; this only protects stale local UI. */
export function resolveVoiceFinishProposal(
  command: ParsedVoiceFinishCommand,
  context: VoiceFinishProposalContext,
): VoiceFinishProposal | VoiceRejectedProposal {
  if (!context.handId || !context.handStarted) return reject("no_active_hand", "Bàn chưa có hand đang chạy.");
  if (context.readOnly) return reject("read_only", "Phiên này chỉ được xem.");
  if (context.syncBlocked) return reject("sync_blocked", "Trạng thái bàn chưa đồng bộ.");
  if (context.correctionPending) return reject("correction_pending", "Đang chờ Floor sửa action trước đó.");
  if (context.workflowState !== "submit_ready") return reject("wrong_workflow", "Chưa đủ điều kiện kết thúc hand.");
  return {
    ok: true,
    intentDomain: "finish_hand",
    command,
    expectedStateVersion: context.expectedStateVersion,
    expectedWorkflowState: "submit_ready",
    expectedStreet: "showdown",
  };
}
