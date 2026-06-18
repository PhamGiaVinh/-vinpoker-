// tests/onlinePoker/showdownResult.test.tsx
// Bug B render proof — the ShowdownResult panel must visibly announce the
// server-authoritative settlement (winner / pot / refund / endedBy) of a completed
// hand. Fixture mirrors the real live-DB hand #3 (seat 3 wins 9700, seat 2 refunded 300).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ShowdownResult } from '@/components/poker/ShowdownResult';
import type { PublicHandResult, PublicSeatView } from '@/lib/onlinePoker/types';

afterEach(cleanup);

const seats: PublicSeatView[] = [
  { seat: 3, playerId: 'u3', displayName: 'An', stack: '9700', committed: '0', status: 'allin', revealedCards: ['6s', 'Kh'] },
  { seat: 2, playerId: 'u2', displayName: 'Bình', stack: '300', committed: '0', status: 'allin', revealedCards: ['6c', '5h'] },
];

const showdownResult: PublicHandResult = {
  endedBy: 'showdown',
  potTotal: '9700',
  potAwards: [{ potIndex: 0, amount: '9700', winners: [3] }],
  payouts: { 3: '9700' },
  refund: { seat: 2, amount: '300' },
};

describe('ShowdownResult — announces the server settlement (Bug B render)', () => {
  it('shows the winner name, pot awarded, the Showdown label and the refund', () => {
    render(<ShowdownResult result={showdownResult} handNo={3} seats={seats} mySeat={2} bb="50" />);
    expect(screen.getByText(/Kết quả ván #3/)).toBeInTheDocument();
    expect(screen.getByText('Showdown')).toBeInTheDocument();
    expect(screen.getByText('An')).toBeInTheDocument();      // winner = seat 3
    expect(screen.getByText(/thắng/)).toBeInTheDocument();
    expect(screen.getByText(/9,700/)).toBeInTheDocument();   // pot awarded
    expect(screen.getByText(/Hoàn/)).toBeInTheDocument();    // uncalled refund line
  });

  it('labels a fold win and shows no refund when none is present', () => {
    const foldResult: PublicHandResult = {
      endedBy: 'fold',
      potTotal: '150',
      potAwards: [{ potIndex: 0, amount: '150', winners: [2] }],
      payouts: { 2: '150' },
    };
    render(<ShowdownResult result={foldResult} handNo={5} seats={seats} mySeat={3} bb="50" />);
    expect(screen.getByText('Đối thủ bỏ bài')).toBeInTheDocument();
    expect(screen.getByText('Bình')).toBeInTheDocument();    // winner = seat 2
    expect(screen.queryByText(/Hoàn/)).not.toBeInTheDocument();
  });

  it('names the viewer as "Bạn" when they are the winner', () => {
    render(<ShowdownResult result={showdownResult} handNo={3} seats={seats} mySeat={3} bb="50" />);
    expect(screen.getByText('Bạn')).toBeInTheDocument();
  });
});
