import { Outlet } from "react-router-dom";
import { Landmark } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { BackButton } from "@/components/BackButton";
import { OpsBottomNav } from "./OpsBottomNav";

/**
 * OpsShell — SafeAreaPageShell cho mobileOpsV2 `/ops/*`. Chrome riêng (KHÔNG dùng Layout, KHÔNG đụng
 * /dealer/*). Nhân bản pattern DealerAppShell: header sticky safe-area · main max-w-md · bottom nav.
 * Gate: flag `mobileOpsV2` OFF + không phải admin/owner → thông báo "chưa bật" (giữ tính năng dark).
 * docs/design/ios-floor-ux-spec.md + ios-operations-implementation-plan.md.
 */
export default function OpsShell() {
  const { isAdmin, isClubOwner, loading: authLoading } = useAuth();
  const flagOn = FEATURES.mobileOpsV2;
  const allowPreview = isAdmin || isClubOwner;

  if (authLoading) return <RouteLoader />;

  if (!flagOn && !allowPreview) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-card border border-primary/30 text-primary">
            <Landmark className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold text-foreground">Vận hành (bản mobile) chưa bật</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Bản thử nghiệm iPhone đang chờ duyệt. Dùng bản máy tính ở mục VẬN HÀNH.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border/60 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto w-full max-w-md flex items-center justify-between gap-2 px-4 h-14">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-card border border-primary/30 text-primary">
              <Landmark className="w-5 h-5" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-display font-black tracking-[0.14em] text-primary">VẬN HÀNH</div>
              <div className="text-[11px] text-muted-foreground -mt-0.5">Floor · bản mobile</div>
            </div>
          </div>
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            DỮ LIỆU MẪU
          </span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-md px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] animate-fade-in">
        <BackButton to="/" label="Về app chính" className="mb-2" />
        <Outlet />
      </main>

      <OpsBottomNav />
    </div>
  );
}
