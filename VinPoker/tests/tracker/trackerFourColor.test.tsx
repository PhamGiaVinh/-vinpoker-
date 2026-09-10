import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { PokerCard } from '@/components/cashier/tournament-live/PokerVisuals';
import { CardSlotPicker } from '@/components/shared/CardSlotPicker';
import { TrackerRacetrack } from '@/components/tracker/TrackerRacetrack';
import { TrackerInputCardProvider, TrackerViewerCardProvider, TrackerCardStyleToggle, TRACKER_CARD_STYLE_KEY } from '@/components/tracker/TrackerCardStyle';

beforeEach(() => { cleanup(); localStorage.clear(); });

describe('four-color deck assets', () => {
  it('contains exactly 52 unique rank/suit faces with correct color and 5:7 geometry', () => {
    const root = 'public/cards/four-color/';
    const files = readdirSync(root).filter(file => file.endsWith('.svg'));
    expect(files).toHaveLength(52);
    for (const [suit, symbol, color] of [['S', '♠', '#303339'], ['H', '♥', '#BB242D'], ['D', '♦', '#2452BE'], ['C', '♣', '#177341']]) {
      for (const rank of 'AKQJT98765432') {
        const svg = readFileSync(`${root}${rank}${suit}.svg`, 'utf8');
        expect(svg).toContain('viewBox="0 0 100 140"');
        expect(svg).toContain(`<title id="title">${rank}${symbol}</title>`);
        expect(svg).toContain(`fill="${color}"`);
        expect(svg.match(new RegExp(`>${rank}</text>`, 'g'))).toHaveLength(2);
      }
    }
  });
});

function Viewer() { return <TrackerViewerCardProvider><TrackerCardStyleToggle /><PokerCard card="10d" /><PokerCard card="As" hidden /><PokerCard /></TrackerViewerCardProvider>; }

it('defaults to four colors; saves classic across remounts and keeps hidden/empty values private', () => {
  const first = render(<Viewer />);
  expect(first.container.querySelector('img')?.getAttribute('src')).toBe('/cards/four-color/TD.svg');
  expect(first.container.querySelectorAll('img')).toHaveLength(1);
  expect(first.container.innerHTML).not.toContain('AS.svg');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểu cũ' }));
  expect(localStorage.getItem(TRACKER_CARD_STYLE_KEY)).toBe('classic');
  expect(first.container.querySelector('img')?.getAttribute('src')).toBe('/cards/xcards/TD.svg');
  first.unmount();
  const second = render(<Viewer />);
  expect(second.container.querySelector('img')?.getAttribute('src')).toBe('/cards/xcards/TD.svg');
});

it('fixed input overrides a saved viewer style, including nested viewer surfaces', () => {
  localStorage.setItem(TRACKER_CARD_STYLE_KEY, 'classic');
  const view = render(<TrackerInputCardProvider><Viewer /></TrackerInputCardProvider>);
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/cards/four-color/TD.svg');
  expect(screen.queryByRole('group')).toBeNull();
});

it('synchronizes existing viewer consumers when another tab changes the preference', () => {
  const view = render(<Viewer />);
  act(() => { localStorage.setItem(TRACKER_CARD_STYLE_KEY, 'classic'); window.dispatchEvent(new StorageEvent('storage', { key: TRACKER_CARD_STYLE_KEY })); });
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/cards/xcards/TD.svg');
});

it('keeps muck private, preserves a dead button and separates selected seat from actor', () => {
  const onSeatTap = vi.fn();
  const view = render(<TrackerInputCardProvider><TrackerRacetrack seats={[
    { seatNumber: 1, name: 'Selected', stack: 1000, holeCards: ['As', 'Ah'], isMucked: true },
    { seatNumber: 4, name: 'Actor', stack: 2000 },
    { seatNumber: 5, name: '', stack: 0, isEmpty: true },
  ]} actingSeatNumber={1} engineToActSeatNumber={4} dealerSeatNumber={5} boardCards={['', '', '', '', '']} pot={0} bigBlind={200} rich showHoleCards onSeatTap={onSeatTap} /></TrackerInputCardProvider>);
  expect(view.container.innerHTML).not.toContain('/AS.svg');
  expect(view.container.innerHTML).not.toContain('/AH.svg');
  expect(view.container.querySelector('[data-seat-selected="true"]')?.getAttribute('data-tracker-seat')).toBe('1');
  expect(view.container.querySelector('[data-seat-acting="true"]')?.getAttribute('data-tracker-seat')).toBe('4');
  expect(view.container.querySelector('[data-tracker-seat="5"]')?.textContent).toContain('D');
  fireEvent.keyDown(view.container.querySelector('[data-tracker-seat="5"]')!, { key: 'Enter' });
  expect(onSeatTap).toHaveBeenCalledWith(5);
});

it('shows a readable fallback and retries when the card or deck changes', () => {
  localStorage.setItem(TRACKER_CARD_STYLE_KEY, 'four-color');
  const view = render(<Viewer />);
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.textContent).toContain('10');
  expect(view.container.textContent).toContain('♦');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểu cũ' }));
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/cards/xcards/TD.svg');
});

it('preserves rank then suit selection, duplicate rejection, replacement and clearing', () => {
  const onChange = vi.fn();
  function Input() {
    const [card, setCard] = useState<string | null>(null);
    return <TrackerInputCardProvider><CardSlotPicker value={card} used={new Set(['As'])} onChange={value => { onChange(value); setCard(value); }} /></TrackerInputCardProvider>;
  }
  const view = render(<Input />);
  fireEvent.click(screen.getByRole('button', { name: 'Chọn lá bài' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn hạng A' }));
  expect(screen.getByRole('button', { name: 'Chọn A♠' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn A♠' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn A♥' }));
  expect(onChange).toHaveBeenLastCalledWith('Ah');
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/cards/four-color/AH.svg');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi lá A♥' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn hạng K' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn K♣' }));
  expect(onChange).toHaveBeenLastCalledWith('Kc');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi lá K♣' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn hạng K' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xoá lá này' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});
