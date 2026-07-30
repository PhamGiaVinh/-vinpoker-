import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Layers3, UserRound } from "lucide-react";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { OpsBottomNav } from "@/components/ops/OpsBottomNav";
import "@/components/ops/ops-ios.css";

/**
 * Independent Ops chrome. It intentionally has no player Layout, player-app
 * navigation, player prompts, profile synchronization, or service worker.
 */
export default function OpsShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const capabilities = useOpsCapabilities();
  const inTournamentWorkspace = /^\/ops\/floor\/tournaments\/[^/]+(?:\/|$)/.test(location.pathname);
  const showModuleSelector =
    capabilities.hasOwnerAccess ||
    (capabilities.hasFloorAccess && capabilities.hasCashierAccess);

  return (
    <div className="ops-root flex min-h-[100dvh] flex-col bg-[#030604] text-[#f2ece6]">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#030604]/88 px-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 w-full max-w-[100rem] items-center justify-between px-4 sm:px-6">
          <div>
            <div className="text-sm font-semibold tracking-wide text-emerald-300">VINPOKER OPS</div>
            <div className="text-xs text-[#91a49b]">Workspace vận hành</div>
          </div>
          <div className="flex items-center gap-2">
            {showModuleSelector && (
              <button
                type="button"
                onClick={() => navigate("/ops/select-module")}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#d8e4de]"
                aria-label="Chọn module"
              >
                <Layers3 className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate("/ops/account")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#d8e4de]"
              aria-label="Tài khoản Ops"
            >
              <UserRound className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-[100rem] flex-1 px-4 pt-4 sm:px-6 lg:pb-8 ${
          inTournamentWorkspace ? "pb-4" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
        }`}
      >
        <Outlet />
      </main>

      {!inTournamentWorkspace && <OpsBottomNav />}
    </div>
  );
}
