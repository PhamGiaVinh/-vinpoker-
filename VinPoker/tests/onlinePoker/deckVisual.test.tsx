// tests/onlinePoker/deckVisual.test.tsx
// PR B — the 3D V card back + centre deck. CardBack shows the gold V; DeckStack is a
// pile of backs; SeatRing shows the DeckStack pre-flop (empty board) and the real board
// once the flop opens (deck must NOT cover the board).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { CardBack } from '@/components/poker/CardBack';
import { DeckStack } from '@/components/poker/DeckStack';
import { SeatRing } from '@/components/poker/SeatRing';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';

afterEach(() => cleanup());

const seat = (n: number, over: Partial<PublicSeatView> = {}): PublicSeatView => ({
  seat: n, playerId: 'u' + n, displayName: 'P' + n, stack: '2000', committed: '0', status: 'active', ...over,
});
const hand = (board: string[]): PublicHandView => ({
  handId: 'h1', tableId: 't1', handNo: 1, street: board.length ? 'flop' : 'preflop',
  board, pot: '75', toActSeat: 1, buttonSeat: 1, status: 'betting',
  seats: [seat(1), seat(2)], mySeat: 1, myHoleCards: ['Ah', 'Kd'],
});

describe('CardBack — 3D V back', () => {
  it('renders the gold V monogram and a face-down aria label', () => {
    render(<CardBack size="lg" />);
    expect(screen.getByText('V')).toBeInTheDocument();
    expect(screen.getByLabelText('face-down card')).toBeInTheDocument();
  });
});

describe('DeckStack — centre deck', () => {
  it('renders a pile of card backs labelled "bộ bài"', () => {
    render(<DeckStack count={4} />);
    const deck = screen.getByLabelText('bộ bài');
    expect(deck).toBeInTheDocument();
    // 4 stacked layers + 1 invisible spacer = 5 backs, all showing the V
    expect(within(deck).getAllByText('V').length).toBeGreaterThanOrEqual(4);
  });
});

describe('SeatRing — deck pre-flop, board on flop', () => {
  it('shows the DeckStack when the board is empty (pre-flop)', () => {
    render(<SeatRing hand={hand([])} bb="50" />);
    expect(screen.getByLabelText('bộ bài')).toBeInTheDocument();
  });
  it('hides the DeckStack and shows community cards once the flop is out', () => {
    render(<SeatRing hand={hand(['Qh', 'Jd', 'Tc'])} bb="50" />);
    expect(screen.queryByLabelText('bộ bài')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Qh')).toBeInTheDocument();
  });
});
