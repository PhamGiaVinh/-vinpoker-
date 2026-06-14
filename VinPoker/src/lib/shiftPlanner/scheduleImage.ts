// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — schedule → PNG (pure SVG + browser canvas, no deps)
// ═══════════════════════════════════════════════════════════════════════════════
// buildScheduleSvg is pure (testable). svgToPngDataUrl rasterizes in the browser
// (canvas) so the result can be sent to Telegram via the send-shift-schedule
// Edge Function. Pure shapes + <text> only → canvas stays untainted, toDataURL OK.

export interface ScheduleImageRow {
  name: string;
  role: string;
  skills: string[];
}
export interface ScheduleImageGroup {
  label: string; // "08–16"
  window: string; // "08:00 – 16:00"
  need: number;
  rows: ScheduleImageRow[];
}
export interface ScheduleImageInput {
  title: string;
  subtitle?: string;
  groups: ScheduleImageGroup[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const W = 760;
const PAD = 24;
const HEADER_H = 64;
const GROUP_HEAD_H = 34;
const ROW_H = 26;
const GROUP_GAP = 12;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Build a light-theme SVG of the schedule. Returns the markup + dimensions. */
export function buildScheduleSvg(input: ScheduleImageInput): { svg: string; width: number; height: number } {
  let y = HEADER_H + PAD;
  const blocks: string[] = [];

  for (const g of input.groups) {
    const short = g.rows.length < g.need;
    // group header band
    blocks.push(
      `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${GROUP_HEAD_H}" rx="8" fill="#eef2f7"/>` +
        `<text x="${PAD + 12}" y="${y + 22}" font-family="${FONT}" font-size="15" font-weight="700" fill="#0f172a">${esc(g.label)}</text>` +
        `<text x="${PAD + 90}" y="${y + 22}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(g.window)}</text>` +
        `<text x="${W - PAD - 12}" y="${y + 22}" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="700" fill="${short ? "#b45309" : "#64748b"}">${g.rows.length}/${g.need}${short ? " · thiếu" : ""}</text>`
    );
    y += GROUP_HEAD_H + 4;

    for (const r of g.rows) {
      const skills = r.skills.slice(0, 3).join(" · ");
      blocks.push(
        `<text x="${PAD + 14}" y="${y + 17}" font-family="${FONT}" font-size="14" fill="#0f172a">• <tspan font-weight="600">${esc(r.name)}</tspan></text>` +
          `<text x="${PAD + 300}" y="${y + 17}" font-family="${FONT}" font-size="12" fill="#475569">${esc(r.role)}</text>` +
          `<text x="${PAD + 400}" y="${y + 17}" font-family="${FONT}" font-size="12" fill="#16a34a">${esc(skills)}</text>`
      );
      y += ROW_H;
    }
    if (g.rows.length === 0) {
      blocks.push(`<text x="${PAD + 14}" y="${y + 16}" font-family="${FONT}" font-size="13" fill="#94a3b8" font-style="italic">— chưa có dealer —</text>`);
      y += ROW_H;
    }
    y += GROUP_GAP;
  }

  const height = y + PAD;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">` +
    `<rect width="${W}" height="${height}" fill="#ffffff"/>` +
    `<text x="${PAD}" y="${PAD + 22}" font-family="${FONT}" font-size="22" font-weight="800" fill="#0f172a">${esc(input.title)}</text>` +
    (input.subtitle ? `<text x="${PAD}" y="${PAD + 44}" font-family="${FONT}" font-size="13" fill="#64748b">${esc(input.subtitle)}</text>` : "") +
    blocks.join("") +
    `</svg>`;
  return { svg, width: W, height };
}

/** Rasterize an SVG string to a PNG data URL via the browser canvas. */
export function svgToPngDataUrl(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("svg render failed")); };
    img.src = url;
  });
}

export async function buildSchedulePng(input: ScheduleImageInput): Promise<string> {
  const { svg, width, height } = buildScheduleSvg(input);
  return svgToPngDataUrl(svg, width, height);
}
