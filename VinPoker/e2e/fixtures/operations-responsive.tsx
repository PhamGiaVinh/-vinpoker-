// Local Vite/Playwright fixture only; not an application entry or production route.
import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { DashboardTab } from "../../src/components/chip-ops/DashboardTab";
import { FloorTableModePicker } from "../../src/components/ops/shared/FloorTableModePicker";

function Fixture() {
  const [mode, setMode] = React.useState<"manual" | "tracker">("manual");
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
