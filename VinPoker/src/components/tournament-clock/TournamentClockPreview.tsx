import { useEffect, useMemo, useState } from "react";
import { VinPokerTournamentClock } from "./VinPokerTournamentClock";
import type { TournamentClockData } from "./types";

const BASE: TournamentClockData = {
  title: "VINPOKER LEAGUE NIGHT",
  players: 64,
  entries: 91,
  reEntries: 27,
  prizePool: "420,000,000 VND",
  totalChips: "6,400,000",
  averageStack: "100,000 · 50 BB",
  levelLabel: "Level 7",
  secondsLeft: 18 * 60 + 42,
  nextBreakSecondsLeft: 6 * 60 + 18,
  currentLevel: "1,000 / 2,000 / 2,000",
  nextLevel: "1,000 / 2,500 / 2,500",
  payouts: [
    { rank: "1st", amount: "120,000,000 VND" },
    { rank: "2nd", amount: "75,000,000 VND" },
    { rank: "3rd", amount: "48,000,000 VND" },
    { rank: "4th", amount: "31,000,000 VND" },
    { rank: "5th", amount: "22,000,000 VND" },
  ],
  footerNote: "Reg end — Level 8",
};

// Sample backgrounds to test readability over different club photos (owner P0-5/6).
const SAMPLE_BG = [
  { label: "Không ảnh nền (fallback)", url: "" },
  { label: "Ảnh tối (poker room)", url: "https://images.unsplash.com/photo-1511193311914-0346f16efe90?q=80&w=1920&auto=format&fit=crop" },
  { label: "Ảnh sáng / bận", url: "https://images.unsplash.com/photo-1567521464027-f127ff144326?q=80&w=1920&auto=format&fit=crop" },
];

/**
 * DEV-only visual harness for VinPokerTournamentClock. Self-ticks the countdown so
 * the motion is visible, and lets the owner swap the club background (incl. a local
 * upload) + toggle the no-break case ("—"). Reached only at /__dev/clock.
 */
export function TournamentClockPreview() {
  const [secondsLeft, setSecondsLeft] = useState(BASE.secondsLeft);
  const [breakLeft, setBreakLeft] = useState(BASE.nextBreakSecondsLeft ?? 0);
  const [noBreak, setNoBreak] = useState(false);
  const [bgUrl, setBgUrl] = useState(SAMPLE_BG[1].url);

  useEffect(() => {
    const t = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 20 * 60));
      setBreakLeft((s) => (s > 0 ? s - 1 : 8 * 60));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const data = useMemo<TournamentClockData>(
    () => ({ ...BASE, secondsLeft, nextBreakSecondsLeft: noBreak ? null : breakLeft, clubBackgroundUrl: bgUrl || null }),
    [secondsLeft, breakLeft, noBreak, bgUrl],
  );

  const btn = (active: boolean) =>
    ({ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(98,255,143,.4)", background: active ? "rgba(98,255,143,.18)" : "transparent", color: "#9fe", cursor: "pointer", fontSize: 13 }) as const;

  return (
    <div style={{ minHeight: "100vh", background: "#010402", display: "grid", placeItems: "center", padding: 14, gap: 12 }}>
      <div style={{ width: "min(100vw - 20px, 1760px)" }}>
        <VinPokerTournamentClock data={data} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: "#9fe", fontSize: 13 }}>
        <span>Nền CLB:</span>
        {SAMPLE_BG.map((b) => (
          <button key={b.label} type="button" onClick={() => setBgUrl(b.url)} style={btn(bgUrl === b.url)}>
            {b.label}
          </button>
        ))}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setBgUrl(URL.createObjectURL(f));
          }}
          style={{ color: "#9fe", maxWidth: 220 }}
        />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={noBreak} onChange={(e) => setNoBreak(e.target.checked)} /> Không có break (test “—”)
        </label>
      </div>
    </div>
  );
}

export default TournamentClockPreview;
