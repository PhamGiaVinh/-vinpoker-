import { formatClock } from "@/lib/tv/format";

/**
 * Central countdown — the visual focus of the clock. A decorative conic-gradient
 * tick ring (NOT a progress arc; an SVG stroke-dashoffset progress fill is a future
 * enhancement once the component receives the level duration) around the level
 * label, the big MM:SS countdown, and the next-break time.
 *
 * nextBreakSecondsLeft is null-safe: when there is no break ahead we render "—",
 * never a misleading 00:00 (owner P0-4).
 */
export function ClockRing({
  levelLabel,
  secondsLeft,
  nextBreakSecondsLeft,
}: {
  levelLabel: string;
  secondsLeft: number;
  nextBreakSecondsLeft: number | null;
}) {
  return (
    <div className="vpc-ring">
      <div className="vpc-ring-inner">
        <div className="vpc-ring-level" style={{ fontSize: "clamp(20px, 3vmin, 44px)" }}>
          {levelLabel}
        </div>
        <div
          className="vpc-ring-time"
          style={{ fontSize: "clamp(58px, 12vmin, 158px)", margin: "2.2vmin 0 1.4vmin" }}
        >
          {formatClock(secondsLeft)}
        </div>
        <div
          className="flex items-center justify-center gap-3"
          style={{ color: "var(--clock-green)", fontSize: "clamp(12px, 1.6vmin, 22px)" }}
          aria-hidden="true"
        >
          <span
            style={{ display: "inline-block", height: 1, width: "8vmin", background: "linear-gradient(90deg, transparent, var(--clock-green))" }}
          />
          ♠
          <span
            style={{ display: "inline-block", height: 1, width: "8vmin", background: "linear-gradient(90deg, var(--clock-green), transparent)" }}
          />
        </div>
        <div
          className="vpc-ring-break"
          style={{ fontSize: "clamp(15px, 2vmin, 32px)", marginTop: "1.6vmin" }}
        >
          <span style={{ opacity: 0.92 }}>Next Break</span>{" "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {nextBreakSecondsLeft != null ? formatClock(nextBreakSecondsLeft) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
