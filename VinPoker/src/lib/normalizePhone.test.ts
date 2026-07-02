import { describe, it, expect } from 'vitest';
import { normalizePhone } from './normalizePhone';

describe('normalizePhone (mirror of SQL public.normalize_phone)', () => {
  it('collapses all four review formats of one mobile to the same canonical', () => {
    const canonical = '0912345678';
    expect(normalizePhone('0912345678')).toBe(canonical);
    expect(normalizePhone('+84 912 345 678')).toBe(canonical);
    expect(normalizePhone('0912 345 678')).toBe(canonical);
    expect(normalizePhone('912345678')).toBe(canonical);
    expect(normalizePhone('84912345678')).toBe(canonical);
  });

  it('strips punctuation, spaces, dashes, parens', () => {
    expect(normalizePhone('(091) 234-5678')).toBe('0912345678');
    expect(normalizePhone(' 09.12.34.56.78 ')).toBe('0912345678');
  });

  it('returns null for empty / whitespace / non-digit input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('is idempotent on an already-canonical number', () => {
    expect(normalizePhone(normalizePhone('+84912345678')!)).toBe('0912345678');
  });

  it('leaves an already-0-prefixed landline (11 digits) unchanged', () => {
    expect(normalizePhone('02838221234')).toBe('02838221234');
  });

  it('does NOT prepend 0 to a 10-digit number that is not 84-prefixed', () => {
    // already starts with 0 -> unchanged; 9-digit rule only fires on exactly 9 digits
    expect(normalizePhone('0987654321')).toBe('0987654321');
  });
});
