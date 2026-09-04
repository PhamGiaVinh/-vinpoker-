import type {
  ParsedVoiceCommand,
  VoiceActionProposal,
  VoiceProposal,
  VoiceProposalContext,
  VoiceProposalFailureCode,
} from "./types";

function reject(
  command: ParsedVoiceCommand | null,
  code: VoiceProposalFailureCode,
  message: string,
): VoiceProposal {
  return { ok: false, command, code, message };
}

export function resolveVoiceProposal(
  command: ParsedVoiceCommand | null,
  context: VoiceProposalContext,
): VoiceProposal {
  if (!command) return reject(null, "command_not_supported", "Chưa nhận ra lệnh poker.");
  if (command.kind === "report_wrong_action" || command.kind === "call_floor") {
    return {
      ok: true,
      command,
      controlAction: command.kind,
      expectedStateVersion: context.expectedStateVersion,
    };
  }
  if (!context.handStarted || !context.handId) {
    return reject(command, "no_active_hand", "Bàn chưa có hand đang chạy.");
  }
  if (!context.actionStepActive) {
    return reject(command, "not_action_step", "Chưa tới lượt nhập hành động.");
  }
  if (context.readOnly) return reject(command, "read_only", "Phiên này chỉ được xem.");
  if (context.syncBlocked) return reject(command, "sync_blocked", "Trạng thái bàn chưa đồng bộ.");
  if (context.correctionPending) {
    return reject(command, "correction_pending", "Đang chờ Floor sửa action trước đó.");
  }
  if (!context.actor || !context.actorView) {
    return reject(command, "actor_missing", "Chưa xác định được người đang tới lượt.");
  }
  if (command.spokenSeatNumber !== null && command.spokenSeatNumber !== context.actor.seatNumber) {
    return reject(
      command,
      "spoken_actor_mismatch",
      `Đang tới Ghế ${context.actor.seatNumber}, nhưng Voice nghe Ghế ${command.spokenSeatNumber}.`,
    );
  }

  const canonicalAction = command.kind === "bet_to"
    ? "bet"
    : command.kind === "raise_to"
      ? "raise"
      : command.kind;
  const legalKey = canonicalAction === "all_in" ? "allIn" : canonicalAction;
  if (!context.actorView.legal[legalKey as keyof typeof context.actorView.legal]) {
    return reject(command, "illegal_action", "Lệnh này không hợp lệ ở trạng thái hiện tại.");
  }

  let betToTotal: number | undefined;
  let expectedActionAmount = 0;
  if (canonicalAction === "call") {
    expectedActionAmount = Math.min(context.actor.currentStack, context.actorView.toCall);
  } else if (canonicalAction === "all_in") {
    expectedActionAmount = context.actor.currentStack;
  }
  if (canonicalAction === "bet" || canonicalAction === "raise") {
    if (!command.amount) {
      return reject(command, "amount_missing", "Lệnh bet/raise cần số chip đích.");
    }
    if (command.amount.ambiguous) {
      return reject(command, "amount_ambiguous", "Số chip chưa rõ đơn vị. Hãy nói rõ nghìn hoặc triệu.");
    }
    if (command.amount.value === null) {
      return reject(command, "amount_missing", "Lệnh bet/raise cần số chip đích.");
    }
    betToTotal = command.amount.value;
    const maxTotal = context.actor.currentBet + context.actor.currentStack;
    if (!Number.isSafeInteger(betToTotal) || betToTotal <= context.actor.currentBet || betToTotal > maxTotal) {
      return reject(command, "amount_out_of_range", "Số chip vượt ngoài stack hoặc không tăng mức cược.");
    }
    if (betToTotal < context.actorView.minRaiseTo && betToTotal !== maxTotal) {
      return reject(command, "raise_too_small", "Mức raise chưa đủ tối thiểu và không phải all-in.");
    }
    expectedActionAmount = betToTotal - context.actor.currentBet;
  }

  const proposal: VoiceActionProposal = {
    ok: true,
    command,
    actor: context.actor,
    canonicalAction,
    expectedStateVersion: context.expectedStateVersion,
    expectedWorkflowState: context.workflowState,
    expectedStreet: context.street,
    expectedActionOrder: context.actionOrder,
    expectedActionAmount,
    ...(betToTotal === undefined ? {} : { betToTotal }),
  };
  return proposal;
}
