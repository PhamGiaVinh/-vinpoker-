// src/lib/onlinePoker/pokerSounds.ts
// PR C — derive which poker sounds to play from a state transition (prev -> next public
// hand view). PURE + conservative by design:
//   * returns [] when prev is null (no sound on the first snapshot / opening a table
//     mid-hand) — never replays a burst of history;
//   * a new hand (handId change) → one 'deal';
//   * within a hand: a community-card growth → 'deal'; per-OPPONENT-seat fold / call /
//     bet / raise / all_in inferred from the committed/status/stack delta;
//   * SKIPS mySeat (the table plays my own action immediately on submit, so deriving it
//     here would double up);
//   * 'check' is the hardest to read from a 2.5s poll, so it is only emitted when the
//     evidence is unambiguous (that seat WAS to act, is no longer, and nothing else on
//     the street changed) — when unsure we stay SILENT (a wrong sound is worse than a
//     missing one).
// Natural de-dup: the caller advances prevHand after each derive, so an unchanged poll
// produces no diff and no sound.

import type { PublicHandView, PublicSeatView } from './types';
import type { ActionType } from './types';
import type { PokerLiveSound } from '@/lib/pokerLiveSound';

/** Map a player ActionType (engine/edge) to its sound. */
export function actionToSound(type: ActionType): PokerLiveSound {
  switch (type) {
    case 'fold': return 'fold';
    case 'check': return 'check';
    case 'call': return 'call';
    case 'bet': return 'bet';
    case 'raise': return 'raise';
    case 'allin': return 'all_in';
  }
}

const numOr0 = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Max chips committed THIS street across all seats (the current bet level). */
function maxCommitted(seats: ReadonlyArray<PublicSeatView>): number {
  return seats.reduce((m, s) => Math.max(m, numOr0(s.committed)), 0);
}

/**
 * Sounds to play for the transition prev -> next. Returns [] when nothing should sound.
 * `mySeat` (my seat number, or null) is skipped so my own action never double-plays.
 */
export function derivePokerSounds(
  prev: PublicHandView | null | undefined,
  next: PublicHandView | null | undefined,
  mySeat: number | null,
): PokerLiveSound[] {
  if (!prev || !next) return [];

  // New hand → a single deal cue (do not derive actions across hands).
  if (prev.handId !== next.handId) {
    return next.status === 'dealing' || next.status === 'betting' ? ['deal'] : [];
  }

  const out: PokerLiveSound[] = [];

  // Community cards were dealt this street (flop/turn/river).
  if ((next.board?.length ?? 0) > (prev.board?.length ?? 0)) out.push('deal');

  const prevBySeat = new Map<number, PublicSeatView>();
  for (const s of prev.seats) prevBySeat.set(s.seat, s);
  const prevMax = maxCommitted(prev.seats);

  for (const s of next.seats) {
    if (mySeat != null && s.seat === mySeat) continue; // my own action sounds on submit
    const p = prevBySeat.get(s.seat);
    if (!p) continue;

    // fold: was live, now folded
    if (p.status === 'active' && s.status === 'folded') { out.push('fold'); continue; }

    const nc = numOr0(s.committed);
    const pc = numOr0(p.committed);
    if (nc > pc) {
      // put chips in: all-in / raise(bet) / call
      if (numOr0(s.stack) === 0 || s.status === 'allin') out.push('all_in');
      else if (nc > prevMax) out.push(prevMax > 0 ? 'raise' : 'bet');
      else out.push('call');
      continue;
    }

    // check — only when the evidence is unambiguous (conservative): this seat was the one
    // to act, is no longer, the street + board are unchanged, and nothing was committed.
    if (
      p.status === 'active' && s.status === 'active' &&
      nc === pc &&
      prev.toActSeat === s.seat && next.toActSeat !== s.seat &&
      next.street === prev.street &&
      (next.board?.length ?? 0) === (prev.board?.length ?? 0)
    ) {
      out.push('check');
    }
  }

  // Keep it gentle — at most a couple of cues per transition (a missed-poll burst should
  // never machine-gun the table).
  return out.slice(0, 3);
}
