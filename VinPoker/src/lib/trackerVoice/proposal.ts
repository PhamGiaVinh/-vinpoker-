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

function formatChipAmount(amount: number): string {
  return amount.toLocaleString("vi-VN");
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
  let actor = context.actor;
  let actorView = context.actorView;
  let offTurn = false;
  if (command.spokenSeatNumber !== null && command.spokenSeatNumber !== actor.seatNumber) {
    const target = context.actionTargets?.find(({ actor: candidate }) => (
      candidate.seatNumber === command.spokenSeatNumber
    ));
    if (!target) {
      return reject(
        command,
        "spoken_actor_mismatch",
        `Ghế ${command.spokenSeatNumber} không còn action hợp lệ ở trạng thái hiện tại.`,
      );
    }
    actor = target.actor;
    actorView = target.actorView;
    offTurn = !target.isCurrentActor;
  }

  const canonicalAction = command.kind === "bet_to"
    ? "bet"
    : command.kind === "raise_to"
      ? "raise"
      : command.kind;
  const legalKey = canonicalAction === "all_in" ? "allIn" : canonicalAction;
  if (!actorView.legal[legalKey as keyof typeof actorView.legal]) {
    if (canonicalAction === "bet" && actorView.toCall > 0) {
      return reject(
        command,
        "illegal_action",
        `Ghế ${actor.seatNumber} đang phải theo ${formatChipAmount(actorView.toCall)}; Bet không hợp lệ. Hãy nói Raise, Call, Fold hoặc All-in.`,
      );
    }
    return reject(command, "illegal_action", "Lệnh này không hợp lệ ở trạng thái hiện tại.");
  }

  let betToTotal: number | undefined;
  let expectedActionAmount = 0;
  if (canonicalAction === "call") {
    expectedActionAmount = Math.min(actor.currentStack, actorView.toCall);
  } else if (canonicalAction === "all_in") {
    expectedActionAmount = actor.currentStack;
    betToTotal = actor.currentBet + actor.currentStack;
    if (command.amount?.ambiguous) {
      return reject(command, "amount_ambiguous", "Số chip all-in chưa rõ đơn vị.");
    }
    if (command.amount && command.amount.value !== betToTotal) {
      const spokenAmount = command.amount.value === null ? "không xác định" : formatChipAmount(command.amount.value);
      return reject(
        command,
        "amount_out_of_range",
        `Số all-in đọc là ${spokenAmount}, nhưng tổng all-in hiện tại của Ghế ${actor.seatNumber} là ${formatChipAmount(betToTotal)}.`,
      );
    }
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
    const maxTotal = actor.currentBet + actor.currentStack;
    if (!Number.isSafeInteger(betToTotal) || betToTotal <= actor.currentBet || betToTotal > maxTotal) {
      return reject(command, "amount_out_of_range", "Số chip vượt ngoài stack hoặc không tăng mức cược.");
    }
    if (betToTotal < actorView.minRaiseTo && betToTotal !== maxTotal) {
      return reject(command, "raise_too_small", "Mức raise chưa đủ tối thiểu và không phải all-in.");
    }
    expectedActionAmount = betToTotal - actor.currentBet;
  }

  const proposal: VoiceActionProposal = {
    ok: true,
    command,
    actor,
    canonicalAction,
    expectedStateVersion: context.expectedStateVersion,
    expectedWorkflowState: context.workflowState,
    expectedStreet: context.street,
    expectedActionOrder: context.actionOrder,
    expectedActionAmount,
    offTurn,
    currentActorSeatNumber: context.actor.seatNumber,
    ...(betToTotal === undefined ? {} : { betToTotal }),
  };
  return proposal;
}
