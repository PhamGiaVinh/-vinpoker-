import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Layers3, UserRound } from "lucide-react";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { getOpsModuleByPath } from "@/ops/registry/opsModuleRegistry";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import "@/components/ops/ops-ios.css";

export default function OpsShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const module = getOpsModuleByPath(location.pathname);
  const clubName = workspace.selectedClubId
    ? capabilities.clubs.find((club) => club.id === workspace.selectedClubId)?.name
      ?? workspace.verifiedSuperAdminClubs.get(workspace.selectedClubId)?.club_name
      ?? `CLB ${maskId(workspace.selectedClubId)}`
    : "Chưa chọn CLB";

  return (
    <div className="ops-root flex min-h-[100dvh] flex-col bg-[#030604] text-[#f2ece6]">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#030604]/92 px-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#91a49b]">
              <span className="truncate text-[#d6e4dc]">{clubName}</span>
              <span aria-hidden>→</span>
              <span className="truncate">{module?.title ?? "Ops"}</span>
              <span aria-hidden>→</span>
              <span className="truncate text-emerald-300">Công việc</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm font-semibold tracking-wide text-white">VINPOKER OPS</span>
              {module && (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#b9c9c0]">
                  {module.defaultState}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/ops/select-module")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-[#d8e4de] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <Layers3 className="h-4 w-4" />
              <span className="hidden sm:inline">Đổi không gian</span>
              <span className="sm:hidden">Đổi</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/ops/account")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#d8e4de] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              aria-label="Tài khoản Ops"
            >
              <UserRound className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:pb-8">
        <Outlet />
      </main>
    </div>
  );
}

function maskId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}
