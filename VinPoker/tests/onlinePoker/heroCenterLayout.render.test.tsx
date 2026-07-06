// tests/onlinePoker/heroCenterLayout.render.test.tsx
// Pins the desktop/tablet "hero sits at the bottom-CENTRE" layout for the online play table.
//
// The change is purely responsive + class-driven (jsdom has no real CSS breakpoints, so the
// className IS the contract, and the pixel geometry is proven separately by Playwright against
// /__dev/table):
//   • heroAsHud (the live/N8 table): the hero is rendered IN the ring as a real bottom-centre
//     seat wrapped `hidden sm:block` (shows on desktop/tablet ≥sm, hidden on phones) — it is NOT
//     the bottom-left corner HUD there. On mobile the corner <HeroHud> (which carries sm:hidden)
//     takes over instead, so exactly one hero shows per breakpoint.
//   • The legacy / spectator / cinematic path (no heroAsHud) is UNCHANGED — the hero is a normal
//     in-ring seat, never the `hidden sm:block` desktop pod.

import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SeatRing } from '@/components/poker/SeatRing';
import { HeroHud } from '@/components/poker/HeroHud';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';

function seat(n: number, over: Partial<PublicSeatView> = {}): PublicSeatView {
  return { seat: n, playerId: `p${n}`, displayName: n === 1 ? 'Bạn' : `Đối ${n}`, stack: '5000', committed: '0', status: 'active', ...over };
}

function hand(n = 6): PublicHandView {
  const seats: PublicSeatView[] = [];
  for (let i = 1; i <= n; i++) seats.push(seat(i));
  seats[n - 1].isButton = true;
  return {
    handId: 'fx', tableId: 'fx', handNo: 1, street: 'flop', board: ['9d', '3c', '4h'],
    pot: '1250', toActSeat: 1, buttonSeat: n, status: 'betting', seats, mySeat: 1, myHoleCards: ['As', 'Kh'],
  };
}

// The hero desktop pod is the ONLY element carrying both `hidden` and `sm:block` in SeatRing
// (the felt watermark uses `hidden … sm:flex`, so it never matches this selector).
const HERO_DESKTOP = '.hidden.sm\\:block';

afterEach(cleanup);

describe('online table — desktop/tablet hero-centre layout', () => {
  it('heroAsHud: renders the hero IN the ring as a bottom-centre desktop pod (hidden sm:block)', () => {
    const { container } = render(<SeatRing hand={hand(6)} bb="50" heroAsHud fill />);
    const pod = container.querySelector(HERO_DESKTOP) as HTMLElement | null;
    expect(pod).not.toBeNull();
    // bottom-CENTRE ellipse anchor + lifted above opponents
    expect(pod!.getAttribute('style')).toContain('left: 50%');
    expect(pod!.getAttribute('style')).toContain('top: 85%');
    expect(pod!.className).toContain('z-20');
    // it is the HERO pod (my own plate), not an opponent
    expect(pod!.textContent).toContain('Bạn');
    // exactly ONE such desktop pod — the hero is not double-drawn
    expect(container.querySelectorAll(HERO_DESKTOP).length).toBe(1);
  });

  it('heroAsHud + 9-max: the hero still resolves to the single centred desktop pod', () => {
    const { container } = render(<SeatRing hand={hand(9)} bb="50" heroAsHud fill />);
    const pods = container.querySelectorAll(HERO_DESKTOP);
    expect(pods.length).toBe(1);
    expect((pods[0] as HTMLElement).getAttribute('style')).toContain('top: 85%');
  });

  it('legacy / spectator (no heroAsHud): hero is a normal in-ring seat — NO desktop-only pod', () => {
    const { container } = render(<SeatRing hand={hand(6)} bb="50" />);
    // the cinematic/spectator felt is byte-identical to before this change
    expect(container.querySelector(HERO_DESKTOP)).toBeNull();
    // the hero name still renders (as an ordinary ring seat)
    expect(container.textContent).toContain('Bạn');
  });

  it('HeroHud (mobile corner) carries sm:hidden so it disappears on desktop/tablet', () => {
    const { container } = render(<HeroHud hand={hand(6)} bb="50" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('sm:hidden');
    // still the bottom-left corner plate on mobile
    expect(root.className).toContain('bottom-[3.25rem]');
    expect(root.className).toContain('left-2');
  });
});
