// tests/onlinePoker/tableDisplay.test.ts
import { describe, it, expect } from 'vitest';
import { occupiedCount, isTableLive, emptyStateLabel } from '@/lib/onlinePoker/tableDisplay';

describe('occupiedCount', () => {
  it('counts only seats held by a player', () => {
    expect(occupiedCount([{ userId: 'a' }, { userId: null }, { userId: 'b' }])).toBe(2);
    expect(occupiedCount([])).toBe(0);
    expect(occupiedCount([{ userId: null }, { userId: null }])).toBe(0);
  });
});

describe('isTableLive', () => {
  it('open/paused with ≥1 seated → live', () => {
    expect(isTableLive('open', 2)).toBe(true);
    expect(isTableLive('paused', 1)).toBe(true);
  });
  it('closed → NOT live even with players (hide stale board)', () => {
    expect(isTableLive('closed', 5)).toBe(false);
  });
  it('empty (occupied 0) → NOT live (hide stale board)', () => {
    expect(isTableLive('open', 0)).toBe(false);
  });
});

describe('emptyStateLabel', () => {
  it('reflects closed / empty / live-idle', () => {
    expect(emptyStateLabel('closed', 3)).toBe('Bàn đã đóng');
    expect(emptyStateLabel('open', 0)).toBe('Bàn trống · chưa có người chơi');
    expect(emptyStateLabel('open', 2)).toBe('Chưa có hand đang chạy');
  });
});
