// Standalone operator Hand Input console — route `/tracker/hand-input`.
//
// A full-screen floor-control surface (mockup) that REUSES the engine-mode write
// path of the embedded HandInputPanel via `useStandaloneHandInput` (same 7
// `tournament-live-update` Edge payloads, same trackerEngine math). The embedded
// panel is left untouched; this is an additive second entry point.
//
// Gated on `FEATURES.trackerEngineMode` (OFF/dark on main): while OFF the route
// renders a friendly notice and NEVER mounts the controller hook (so no engine
// orchestration runs in production). The hook lives in an inner component so the
// flag/auth guards can short-circuit before any hook call — Rules of Hooks safe.

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Construction, ShieldAlert } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { HandInputConsole } from "@/components/cashier/tournament-live/handinput/HandInputConsole";
import { TrackerUnifiedOpsFixtureShell } from "@/components/cashier/tournament-live/handinput/unified/TrackerUnifiedOpsFixtureShell";
import { getTrackerFixtureTables } from "@/lib/tracker-unified-ops/fixturePresentation";
import { resolveTrackerHandInputRouteV2 } from "@/lib/tracker-unified-ops/navigation";
import type { TrackerOpsRole } from "@/lib/tracker-unified-ops/contracts";

/** Inner component: only mounted when the flag is ON and a tournament id exists.
 * Shares the SAME embeddable console as the operator "Nhập hand" tab (no drift). */
function ConsoleInner({ tournamentId }: { tournamentId: string }) {
  return (
    <div className="container mx-auto p-3 md:p-6">
      <HandInputConsole tournamentId={tournamentId} />
    </div>
  );
}

export default function TrackerHandInputConsole() {
  const {
    user,
    loading,
    isAdmin,
    isClubOwner,
    isTracker,
    isFloor,
    isChipMaster,
  } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const tournamentId = searchParams.get("tournament") ?? "";
  const unifiedTournamentId =
    searchParams.get("t") ?? searchParams.get("tournament") ?? "";
  const unifiedRoute = resolveTrackerHandInputRouteV2(
    searchParams,
    unifiedTournamentId ? getTrackerFixtureTables(unifiedTournamentId) : [],
  );
  const canonicalReplaceHref =
    FEATURES.trackerUnifiedOpsFlow &&
    unifiedRoute.kind !== "error" &&
    unifiedRoute.needs_replace
      ? unifiedRoute.canonical_href
      : null;
  const unifiedRole: TrackerOpsRole | null =
    isAdmin || isClubOwner
      ? "owner"
      : isTracker
        ? "tracker"
        : isFloor
          ? "floor"
          : isChipMaster
            ? "chipmaster"
            : null;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav("/auth");
    }
  }, [loading, user, nav]);

  useEffect(() => {
    if (canonicalReplaceHref) {
      nav(canonicalReplaceHref, { replace: true });
    }
  }, [canonicalReplaceHref, nav]);

  if (loading || !user) {
    return (
      <div className="container mx-auto p-6">
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (FEATURES.trackerUnifiedOpsFlow) {
    if (!unifiedRole) {
      return (
        <div className="min-h-[100dvh] bg-[#0a080b] px-4 py-10 text-[#f4eee5]">
          <Card className="mx-auto max-w-lg space-y-3 border-amber-300/30 bg-[#120e12] p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-amber-300" />
            <div className="text-lg font-bold">Chưa có quyền vận hành Tracker</div>
            <p className="text-sm leading-6 text-[#a99fa6]">
              Trang V2 chỉ mở cho Tracker, Floor, ChipMaster hoặc owner. Backend tương lai vẫn kiểm tra lại quyền theo đúng CLB.
            </p>
          </Card>
        </div>
      );
    }

    return (
      <TrackerUnifiedOpsFixtureShell
        tournamentId={unifiedTournamentId}
        tournamentTableId={
          unifiedRoute.kind === "table"
            ? unifiedRoute.tournament_table_id
            : null
        }
        routeError={unifiedRoute.kind === "error" ? unifiedRoute.error : null}
        role={unifiedRole}
      />
    );
  }

  // The console is gated by its OWN flag (decoupled from the embedded engine mode).
  // While OFF (dark on main) we DON'T mount the controller hook — friendly notice only.
  if (!FEATURES.trackerHandInputConsole) {
    return (
      <div className="container mx-auto p-6">
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Construction className="mx-auto h-10 w-10 text-amber-400" />
          <div className="text-lg font-bold">Bảng nhập hand toàn màn hình đang thử nghiệm</div>
          <p className="text-sm text-muted-foreground">
            Màn nhập hand kiểu mới chưa được bật. Bạn vẫn nhập hand như bình thường ở tab “Nhập hand”
            trong trang Tracker.
          </p>
        </Card>
      </div>
    );
  }

  if (!tournamentId) {
    return (
      <div className="container mx-auto p-6">
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-warning" />
          <div className="text-lg font-bold">Thiếu mã giải đấu</div>
          <p className="text-sm text-muted-foreground">
            Mở console này từ trang Tracker của một giải đấu, hoặc thêm <code className="font-mono">?tournament=…</code>{" "}
            vào địa chỉ.
          </p>
        </Card>
      </div>
    );
  }

  return <ConsoleInner tournamentId={tournamentId} />;
}
