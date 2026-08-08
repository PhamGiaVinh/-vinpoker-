import { Outlet, useNavigate } from "react-router-dom";
import { UserRound } from "lucide-react";
import { OpsBottomNav } from "@/components/ops/OpsBottomNav";
import "@/components/ops/ops-ios.css";

export default function OpsHubShell() {
  const navigate = useNavigate();
  return (
    <div className="ops-root flex min-h-[100dvh] flex-col bg-[#030604] text-[#f2ece6]">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#030604]/92 px-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div>
            <div className="text-sm font-semibold tracking-[0.14em] text-emerald-300">VINPOKER OPS</div>
            <div className="text-xs text-[#91a49b]">Control Deck vận hành CLB</div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/ops/account")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#d8e4de] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            aria-label="Tài khoản Ops"
          >
            <UserRound className="h-5 w-5" />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:pb-10">
        <Outlet />
      </main>
      <OpsBottomNav />
    </div>
  );
}
