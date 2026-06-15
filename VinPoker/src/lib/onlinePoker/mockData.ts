// src/lib/onlinePoker/mockData.ts
// GE-2D shell — deterministic MOCK data for the dark online-poker UI. No network,
// no engine. Shapes match the server's public contract so swapping in real data
// (a Supabase select on online_poker_tables / online_poker_hands.state plus
// op_get_my_hole_cards) is a drop-in later. Nothing here decides cards, winners,
// or chips — it is a fixed snapshot purely for laying out the shell.

import type { LobbyTableSummary, PublicHandView, WalletView } from './types';
import type { WireLegalActions } from './wire';

export const MOCK_WALLET: WalletView = { balance: '1000000', lastGrantDay: undefined };

export const MOCK_TABLES: LobbyTableSummary[] = [
  { id: 'demo-1', name: 'Neon NL Hold’em', sb: '25', bb: '50', maxSeats: 6, seatedCount: 4, status: 'open' },
  { id: 'demo-2', name: 'Saigon High', sb: '100', bb: '200', maxSeats: 9, seatedCount: 7, status: 'open' },
  { id: 'demo-3', name: 'Heads-Up Arena', sb: '50', bb: '100', maxSeats: 2, seatedCount: 1, status: 'open' },
  { id: 'demo-4', name: 'Late Reg Grind', sb: '25', bb: '50', maxSeats: 6, seatedCount: 0, status: 'paused' },
];

export function findMockTable(id: string): LobbyTableSummary | undefined {
  return MOCK_TABLES.find((t) => t.id === id);
}

/**
 * A frozen mid-flop 6-max snapshot. The viewer ("me") is seat 3 and holds two
 * cards (the private overlay); every other seat's hole cards are absent — exactly
 * what the real public projection guarantees. The hero (seat 3) is the one TO ACT,
 * facing seat 4's 150 bet, so the dark action bar renders a realistic preview.
 * Seat 6 is empty, seat 5 is sitting out (carried in the view but not contesting).
 */
export function mockHand(tableId: string): PublicHandView {
  return {
    handId: 'demo-hand-1',
    tableId,
    handNo: 42,
    street: 'flop',
    board: ['Ah', 'Kd', '7c'],
    pot: '475',
    toActSeat: 3,
    buttonSeat: 2,
    status: 'betting',
    mySeat: 3,
    myHoleCards: ['Qs', 'Jh'],
    seats: [
      { seat: 1, playerId: 'u1', displayName: 'Minh',  stack: '1875', committed: '0',   status: 'active', isButton: false, isToAct: false },
      { seat: 2, playerId: 'u2', displayName: 'Linh',  stack: '2100', committed: '0',   status: 'active', isButton: true,  isToAct: false },
      { seat: 3, playerId: 'me', displayName: 'Bạn',   stack: '1550', committed: '0',   status: 'active', isButton: false, isToAct: true  },
      { seat: 4, playerId: 'u4', displayName: 'Khoa',  stack: '980',  committed: '150', status: 'active', isButton: false, isToAct: false },
      { seat: 5, playerId: 'u5', displayName: 'Trang', stack: '1320', committed: '0',   status: 'sitting_out', isButton: false, isToAct: false },
      { seat: 6, playerId: null,                        stack: '0',    committed: '0',   status: 'empty', isButton: false, isToAct: false },
    ],
  };
}

/**
 * MOCK server legal-actions menu for the dark shell, returned ONLY when the viewer
 * is the seat to act. In the live runtime this comes from the Edge (the engine's
 * `legalActions`); here it is a fixed snapshot matching `mockHand`: the hero faces a
 * 150 bet, can fold/call/raise/all-in, min-raise to 300, all-in (max raise to) = its
 * whole stack. The client NEVER computes this — it only renders what it is given.
 */
export function mockLegalActions(hand: PublicHandView): WireLegalActions | undefined {
  if (hand.mySeat == null || hand.toActSeat !== hand.mySeat) return undefined;
  const me = hand.seats.find((s) => s.seat === hand.mySeat);
  return {
    seat: hand.mySeat,
    types: ['fold', 'call', 'raise', 'allin'],
    toCall: '150',
    canCheck: false,
    minRaiseTo: '300',
    maxRaiseTo: me?.stack ?? '0',
  };
}
