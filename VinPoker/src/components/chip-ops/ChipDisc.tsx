// Reusable poker-chip disc (conic-gradient edge). Value/colour are data-driven (a chip's
// physical colour), styled with PokerVN tokens elsewhere. No theme hex hardcoded.
const shortLabel = (v: number) =>
  v >= 1000 ? (v % 1000 === 0 ? `${v / 1000}K` : `${(v / 1000).toFixed(1)}K`) : String(v);

// Pick readable text colour for a given chip background (handles white/yellow chips).
function textColorFor(bg?: string | null): string {
  if (!bg) return "#fff";
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1a1a1a" : "#fff";
}

export function ChipDisc({
  value,
  color,
  size = 44,
  label,
}: {
  value: number;
  color?: string | null;
  size?: number;
  label?: string;
}) {
  const bg = color || "hsl(var(--muted))";
  const edge = size * 0.13;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: bg, boxShadow: "inset 0 0 0 3px rgba(255,255,255,.16), 0 4px 10px rgba(0,0,0,.5)" }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "repeating-conic-gradient(rgba(255,255,255,.85) 0 7deg, transparent 7deg 20deg)",
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${edge}px), #000 calc(100% - ${edge}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${edge}px), #000 calc(100% - ${edge}px))`,
        }}
      />
      <span
        className="relative font-display font-bold"
        style={{ fontSize: size * 0.27, color: textColorFor(color), textShadow: "0 1px 2px rgba(0,0,0,.45)" }}
      >
        {label ?? shortLabel(value)}
      </span>
    </div>
  );
}

export default ChipDisc;
