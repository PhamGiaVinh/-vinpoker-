// Local Vite/Playwright fixture only; not an application entry or production route.
import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/i18n";
import { ClockPanel } from "../../src/components/cashier/tournament-live/ClockPanel";
import { PrizesPanel } from "../../src/components/cashier/tournament-live/viewer-hub/PrizesPanel";
import { VinPokerTournamentClock } from "../../src/components/tournament-clock/VinPokerTournamentClock";
import { TrackerReadOnlyRoster } from "../../src/components/cashier/tournament-live/handinput/unified/TrackerReadOnlyRoster";
import { DashboardTab } from "../../src/components/chip-ops/DashboardTab";
import { FloorTableModePicker } from "../../src/components/ops/shared/FloorTableModePicker";

function Fixture() {
  const [mode, setMode] = React.useState<"manual" | "tracker">("manual");
  const surface = new URLSearchParams(location.search).get("surface");
  if (surface === "clock") return <VinPokerTournamentClock data={{
    title: "Giải vô địch câu lạc bộ · FINAL TABLE", players: 9, entries: 199, reEntries: 99,
    prizePool: "420.000.000 VND", totalChips: "98.765.432", averageStack: "10.973.937",
    levelLabel: "Level 20", secondsLeft: 1200, nextBreakSecondsLeft: 3600,
    currentLevel: "500.000 / 1.000.000 / 1.000.000", nextLevel: "1.000.000 / 2.000.000 / 2.000.000",
    payouts: [{ rank: "1st", amount: "250.000.000 VND" }], footerNote: "Kết thúc đăng ký tại Level 8",
  }} />;
  if (surface === "panels") return <main className="operations-typography mx-auto max-w-5xl space-y-6 p-4">
    <p>LOCAL TEST · Đồng hồ / Payout / Tracker</p>
    <ClockPanel tournamentId="responsive-test" />
    <PrizesPanel tournamentId="responsive-test" />
    <TrackerReadOnlyRoster roster={[{ seat_id: "seat-test", entry_id: "entry-test", player_id: "player-test", entry_number: 999999, seat_number: 1, seat_stack: 987654321000, tracker_stack: 987654321000, entry_stack: 987654321000, display_name: "Nguyễn_Văn_Tên_Rất_Dài_".repeat(5), avatar_url: null }]} />
  </main>;
  return <main className="operations-typography mx-auto max-w-5xl space-y-6 p-4">
    <p className="text-sm text-muted-foreground">LOCAL TEST · Dữ liệu giả lập · Không kết nối production</p>
    <h1 className="text-xl">Chip Master · Kiểm tra hiển thị</h1>
    <DashboardTab tournamentId="responsive-test" inv={{ total_value: 0, reconciled: false, denominations: [] }} denoms={[]} />
    <section style={{ maxWidth: 320 }} aria-label="Panel hẹp trên desktop">
      <h2 className="mb-3 text-lg">Loại bàn</h2>
      <FloorTableModePicker value={mode} onChange={setMode} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
