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
import { AlertTriangle, Construction } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { useStandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { StandaloneHandInputConsole } from "@/components/cashier/tournament-live/handinput/StandaloneHandInputConsole";

/** Inner component: only mounted when the flag is ON and a tournament id exists. */
function ConsoleInner({ tournamentId }: { tournamentId: string }) {
  const hook = useStandaloneHandInput(tournamentId);
  return (
    <div className="container mx-auto p-3 md:p-6">
      <StandaloneHandInputConsole hook={hook} />
    </div>
  );
}

export default function TrackerHandInputConsole() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const tournamentId = searchParams.get("tournament") ?? "";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav("/auth");
    }
  }, [loading, user, nav]);

  if (loading || !user) {
    return (
      <div className="container mx-auto p-6">
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  // Engine mode is the whole point of this console. While the flag is OFF (dark on
  // main) we DON'T mount the hook — show a friendly notice instead.
  if (!FEATURES.trackerEngineMode) {
    return (
      <div className="container mx-auto p-6">
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Construction className="mx-auto h-10 w-10 text-amber-400" />
          <div className="text-lg font-bold">Bảng nhập hand đang được thử nghiệm</div>
          <p className="text-sm text-muted-foreground">
            Màn hình nhập hand kiểu mới (Tracker Engine Mode) đang ở chế độ thử nghiệm và chưa được bật.
            Bạn vẫn có thể nhập hand như bình thường trong trang Tracker.
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
