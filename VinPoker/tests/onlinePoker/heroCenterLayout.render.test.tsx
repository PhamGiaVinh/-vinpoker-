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

// ── N8-ratio mobile felt (owner mockup v3) ─────────────────────────────────────────────
// The stadium shape + lifted board are CLASS-driven (sm:-reverting) and gated to heroAsHud;
// pixel geometry is proven by Playwright against /__dev/table — these pins freeze the contract.

describe('online table — N8 stadium mobile felt', () => {
  it('heroAsHud: stadium radii + lifted board classes present (sm: reverts to the oval)', () => {
    const { container } = render(<SeatRing hand={hand(9)} bb="50" heroAsHud fill />);
    const html = container.innerHTML;
    expect(html).toContain('rounded-[46%_/_21%]');
    expect(html).toContain('sm:rounded-[48%]');
    expect(html).toContain('top-[31%]');
    expect(html).toContain('sm:top-1/2');
  });

  it('legacy / cinematic (no heroAsHud): keeps the 48% oval and the true-centre board', () => {
    const { container } = render(<SeatRing hand={hand(6)} bb="50" />);
    const html = container.innerHTML;
    expect(html).not.toContain('rounded-[46%_/_21%]');
    expect(html).not.toContain('top-[31%]');
    expect(html).toContain('rounded-[48%]');
  });

  it('HeroHud: hero cards render LARGE (lg) and fanned — N8 rule replaces everything-equal', () => {
    const { container } = render(<HeroHud hand={hand(9)} bb="50" />);
    const html = container.innerHTML;
    expect(html).toContain('h-16 w-11'); // PlayingCard size lg
    expect(html).toContain('-rotate-[5deg]');
    expect(html).toContain('rotate-[6deg]');
  });
});

describe('N8 mobile slot map (mockup v3 contract)', () => {
  it('no opponent slot sits below y=48 — the lower felt belongs to the hero + dock', async () => {
    const { MOBILE_OPP_SLOTS_6MAX, MOBILE_OPP_SLOTS_9MAX, MOBILE_HERO_ANCHOR, MOBILE_POT_CENTER } =
      await import('@/components/poker/mobileTableLayout');
    expect(Math.max(...MOBILE_OPP_SLOTS_9MAX.map((s) => s.y))).toBeLessThanOrEqual(48);
    expect(Math.max(...MOBILE_OPP_SLOTS_6MAX.map((s) => s.y))).toBeLessThanOrEqual(48);
    expect(MOBILE_OPP_SLOTS_9MAX).toHaveLength(8);
    expect(MOBILE_HERO_ANCHOR).toMatchObject({ x: 18, y: 80 });
    expect(MOBILE_POT_CENTER).toEqual({ x: 50, y: 38 });
  });
});
