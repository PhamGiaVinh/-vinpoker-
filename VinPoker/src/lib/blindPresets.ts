// Built-in starter blind structures ("mẫu chuẩn") the floor can load into the
// editor or pick at tournament creation, then tweak / save as a club template.
// These are code constants only — they are NEVER written to the DB on their own;
// the floor explicitly saves a chosen structure as a blind_structure_templates row.

export interface BlindLevel {
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

export interface BlindTemplate {
  id: string;
  club_id: string;
  name: string;
  levels: BlindLevel[];
}

export interface BlindPreset {
  key: string;
  name: string;
  levels: BlindLevel[];
}

// A standard NLH ladder; big-blind ante kicks in from level 4.
const LADDER: Array<[number, number]> = [
  [100, 100],
  [100, 200],
  [200, 300],
  [200, 400],
  [300, 600],
  [400, 800],
  [500, 1000],
  [700, 1400],
  [1000, 2000],
  [1500, 3000],
  [2000, 4000],
  [3000, 6000],
];

// Insert one 15-minute break after `breakAfter` playing levels.
function build(durationMinutes: number, breakAfter: number): BlindLevel[] {
  const out: BlindLevel[] = [];
  let lvl = 1;
  LADDER.forEach(([sb, bb], idx) => {
    out.push({
      level_number: lvl++,
      small_blind: sb,
      big_blind: bb,
      ante: idx >= 3 ? bb : 0,
      duration_minutes: durationMinutes,
      is_break: false,
    });
    if (idx + 1 === breakAfter) {
      out.push({ level_number: lvl++, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 15, is_break: true });
    }
  });
  return out;
}

export const BLIND_PRESETS: BlindPreset[] = [
  { key: "standard", name: "Standard 20'", levels: build(20, 6) },
  { key: "turbo", name: "Turbo 15'", levels: build(15, 6) },
  { key: "hyper", name: "Hyper 10'", levels: build(10, 6) },
  { key: "deep", name: "Deepstack 30'", levels: build(30, 6) },
];

// Strip to the canonical level shape (drops UI-only fields, renumbers sequentially).
export function normalizeLevels(rows: Array<Partial<BlindLevel>>): BlindLevel[] {
  return rows.map((r, i) => ({
    level_number: i + 1,
    small_blind: Number(r.small_blind) || 0,
    big_blind: Number(r.big_blind) || 0,
    ante: Number(r.ante) || 0,
    duration_minutes: Number(r.duration_minutes) || 0,
    is_break: !!r.is_break,
  }));
}
