// tests/onlinePoker/allinRunout.test.tsx
// Render proof for the cinematic endpoints: it opens on the banner with NO result and NO
// action buttons, and (via the reduced-motion path, which starts at the final phase) it
// shows the SERVER-authoritative result and calls onDone after the hold. The phase
// progression itself is covered purely in allinCinematic.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { AllInRunout } from '@/components/poker/AllInRunout';
import type { PublicHandView } from '@/lib/onlinePoker/types';

function allInHand(): PublicHandView {
  return {
    handId: 'h', tableId: 't', handNo: 7, street: 'showdown',
    board: ['2s', 'Qd', 'Ad', '3d', '4h'], pot: '0', toActSeat: null, buttonSeat: 1, status: 'complete',
    result: { endedBy: 'showdown', potTotal: '20000', potAwards: [{ potIndex: 0, amount: '20000', winners: [2] }], payouts: { 2: '20000' } },
    seats: [
      { seat: 1, playerId: 'a', displayName: 'An', stack: '0', committed: '0', status: 'allin', revealedCards: ['8s', 'Tc'] },
      { seat: 2, playerId: 'b', displayName: 'Bình', stack: '20000', committed: '0', status: 'allin', revealedCards: ['Ac', '5d'] },
    ],
    mySeat: 1, myHoleCards: ['8s', 'Tc'],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mq = (matches: boolean) => (q: string): any => ({
  matches, media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // restore the default setup.ts mock (no reduced motion)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: mq(false) });
});

describe('AllInRunout cinematic', () => {
  it('opens on the "All-in!" banner with NO result and NO action buttons', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mq(false) });
    render(<AllInRunout hand={allInHand()} bb="50" />);
    expect(screen.getByText('All-in!')).toBeInTheDocument();
    expect(screen.queryByText(/Kết quả ván/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fold')).not.toBeInTheDocument();   // never an ActionBar
    expect(screen.queryByText('Check')).not.toBeInTheDocument();
  });

  it('reduced-motion jumps to the final phase → shows the SERVER result (winner + pot)', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mq(true) });
    render(<AllInRunout hand={allInHand()} bb="50" />);
    expect(screen.getByText(/Kết quả ván/)).toBeInTheDocument();  // result panel present
    expect(screen.getByText(/20,000/)).toBeInTheDocument();       // pot from server result, not computed
    expect(screen.getAllByText('Bình').length).toBeGreaterThan(0); // winner = seat 2 (felt + result line)
  });

  it('calls onDone once after the final result hold', async () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mq(true) });
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<AllInRunout hand={allInHand()} bb="50" onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); }); // single final-hold timer
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
