export interface SrtCue {
  id: number;
  startTime: number; // seconds
  endTime: number;   // seconds
  text: string;
}

const tsToSeconds = (ts: string): number => {
  // 00:01:23,456 or 00:01:23.456
  const m = ts.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  const [, h, mm, ss, ms] = m;
  return (
    parseInt(h, 10) * 3600 +
    parseInt(mm, 10) * 60 +
    parseInt(ss, 10) +
    parseInt(ms.padEnd(3, "0"), 10) / 1000
  );
};

export function parseSrt(input: string): SrtCue[] {
  if (!input) return [];
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const blocks = text.split(/\n{2,}/);
  const cues: SrtCue[] = [];
  let autoId = 1;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    let idx = 0;
    let id = autoId;
    if (/^\d+$/.test(lines[0])) {
      id = parseInt(lines[0], 10);
      idx = 1;
    }
    const timing = lines[idx];
    if (!timing || !timing.includes("-->")) continue;
    const [a, b] = timing.split("-->").map((s) => s.trim());
    const startTime = tsToSeconds(a);
    const endTime = tsToSeconds(b);
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) continue;
    const body = lines.slice(idx + 1).join("\n").trim();
    if (!body) continue;
    cues.push({ id, startTime, endTime, text: body });
    autoId = id + 1;
  }

  cues.sort((a, b) => a.startTime - b.startTime);
  return cues;
}

export function findActiveCue(cues: SrtCue[], t: number): SrtCue | null {
  if (cues.length === 0) return null;
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.startTime) hi = mid - 1;
    else if (t > c.endTime) lo = mid + 1;
    else return c;
  }
  return null;
}
