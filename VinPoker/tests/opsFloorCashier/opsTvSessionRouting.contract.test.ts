import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(repo, path), "utf8");

describe("Ops Floor TV session routing", () => {
  it("keeps the Floor TV route behind the Ops session and tournament scope gates", () => {
    const app = source("src/OpsApp.tsx");

    expect(app).toContain('const OpsTournamentTv = lazy(() => import("@/pages/ops/OpsTournamentTv"));');
    expect(app).toContain('path="/ops/floor/tournaments/:id/tv"');
    expect(app).toContain("<OpsTournamentScopeGate>");
  });

  it("opens Floor TV inside Ops instead of crossing into the Player-app TV route", () => {
    const cockpit = source("src/pages/ops/OpsTournamentCockpit.tsx");

    expect(cockpit).toContain("useLocation");
    expect(cockpit).toContain("href={`/ops/floor/tournaments/${id}/tv${location.search}`}");
    expect(cockpit).not.toContain("href={`/tv/${id}`}");
  });

  it("uses the independent Ops session for the fullscreen TV data adapter", () => {
    const tv = source("src/pages/ops/OpsTournamentTv.tsx");

    expect(tv).toContain("useOpsAuth");
    expect(tv).toContain("useTournamentTvDataCore");
    expect(tv).not.toContain('from "@/hooks/useAuth"');
    expect(tv).toContain("Quay lại Floor");
  });
});
