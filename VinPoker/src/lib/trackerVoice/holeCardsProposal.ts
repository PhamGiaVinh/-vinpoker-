import type {
  ParsedVoiceHoleCardsCommand,
  VoiceHoleCardsProposal,
  VoiceHoleCardsProposalContext,
  VoiceRejectedProposal,
} from "./types";

function reject(code: VoiceRejectedProposal["code"], message: string): VoiceRejectedProposal {
  return { ok: false, command: null, code, message };
}

/** Creates a private in-memory hole-card draft. It never touches the generic event stream. */
export function resolveVoiceHoleCardsProposal(
  command: ParsedVoiceHoleCardsCommand,
  context: VoiceHoleCardsProposalContext,
): VoiceHoleCardsProposal | VoiceRejectedProposal {
  if (!context.handStarted || !context.handId) return reject("no_active_hand", "Bàn chưa có hand đang chạy.");
  if (context.readOnly) return reject("read_only", "Phiên này chỉ được xem.");
  if (context.syncBlocked) return reject("sync_blocked", "Trạng thái bàn chưa đồng bộ.");
  if (context.correctionPending) return reject("correction_pending", "Đang chờ Floor sửa action trước đó.");
  if (context.workflowState === "showdown_input") {
    return reject(
      "showdown_hole_cards_deferred_muck_authority",
      "Showdown Voice chưa mở vì muck chưa có bằng chứng server-authoritative.",
    );
  }
  if (context.workflowState !== "runout_reveal") {
    return reject("wrong_workflow", "Voice bài tẩy chỉ dùng ở bước lật bài all-in runout.");
  }
  const player = context.players.find((candidate) => candidate.seatNumber === command.seatNumber);
  if (!player) return reject("hole_cards_seat_not_found", "Ghế được đọc không có người chơi trong hand này.");
  const ownCards = context.localCardsByPlayerId[player.playerId] ?? [];
  if (ownCards.filter(Boolean).length > 0) {
    return reject("hole_cards_local_draft_exists", "Ghế này đang có bài nhập tay chưa xác nhận; Voice không ghi đè.");
  }
  for (const [playerId, cards] of Object.entries(context.localCardsByPlayerId)) {
    if (playerId === player.playerId) continue;
    const existing = cards.filter((card): card is string => Boolean(card));
    if (existing.some((card) => command.cards.includes(card))) {
      return reject("duplicate_card", "Lá bài Voice đề xuất trùng với draft cục bộ của ghế khác.");
    }
  }
  return {
    ok: true,
    intentDomain: "hole_cards",
    command,
    player,
    expectedStateVersion: context.expectedStateVersion,
    expectedWorkflowState: "runout_reveal",
    expectedStreet: "showdown",
  };
}
