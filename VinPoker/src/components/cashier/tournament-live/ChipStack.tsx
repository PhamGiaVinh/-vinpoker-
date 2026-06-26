import type { CSSProperties } from "react";

// RPT-style committed-bet CHIP STACK shown on the felt in front of a seat (toward the
// pot). A fixed 3-disc pile of LIGHT single-gradient discs (the .tracker-chip-push
// recipe — NOT the heavy ChipDisc, which would cost a conic-mask ×9 seats) + the amount
// label below. all-in → red pile + white-on-red label; regular → gold pile + emerald-on-
// dark label. Pure presentation: the i18n'd `label` + the responsive `sizeStyle` (disc
// `width` + label `fontSize` as clamp()) are computed by LiveFelt so this stays geometry-
// agnostic. Decorative discs are aria-hidden; the amount label is real, high-contrast text.

const RED = "radial-gradient(circle at 35% 30%, #ff8a8a, #d33 55%, #7a1111 100%)";
const GOLD = "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)";
const DISCS = 3;
const STEP = 0.34; // each chip sits this fraction-of-a-diameter above the one below

export function ChipStack({
  label,
  allIn = false,
  sizeStyle,
}: {
  label: string;
  allIn?: boolean;
  sizeStyle?: CSSProperties;
}) {
  const w = (sizeStyle?.width as string) ?? "14px";
  const fontSize = (sizeStyle?.fontSize as string) ?? "8px";
  const disc = allIn ? RED : GOLD;
  return (
    <div className="tracker-bet-pulse flex flex-col items-center" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,.55))" }}>
      <div className="relative" style={{ width: w, aspectRatio: `1 / ${1 + (DISCS - 1) * STEP}` }}>
        {Array.from({ length: DISCS }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="absolute left-0 rounded-full"
            style={{
              width: w,
              aspectRatio: "1",
              background: disc,
              boxShadow: "0 0 0 1px rgba(0,0,0,.45)",
              bottom: `calc(${i} * ${w} * ${STEP})`,
              zIndex: i,
            }}
          />
        ))}
      </div>
      <div
        className="tracker-num mt-0.5 whitespace-nowrap font-bold leading-none"
        style={
          allIn
            ? { fontSize, background: "rgb(184,31,31)", border: "0.8px solid rgba(255,150,150,0.9)", color: "#fff", borderRadius: "9999px", padding: "1px 5px" }
            : { fontSize, background: "rgba(0,0,0,0.65)", border: "1px solid hsl(146 62% 56% / 0.45)", color: "hsl(146 62% 56%)", borderRadius: "6px", padding: "1px 5px" }
        }
      >
        {label}
      </div>
    </div>
  );
}
