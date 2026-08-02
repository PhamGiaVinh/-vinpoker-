import { Navigate, useNavigate } from "react-router-dom";
import { Banknote, Grid3X3, UserRound } from "lucide-react";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";

export default function OpsSelectModule() {
  const navigate = useNavigate();
  const capabilities = useOpsCapabilities();
  if (capabilities.loading) return null;
  if (!capabilities.hasOwnerAccess && !(capabilities.hasFloorAccess && capabilities.hasCashierAccess)) {
    return <Navigate to="/ops" replace />;
  }

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-5xl bg-[#060b09] px-4 py-8 text-white sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">VinPoker Ops</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Chọn không gian làm việc</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
            Mỗi module dùng đúng capability từ server; tên CLB chỉ là thông tin hiển thị.
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/account")}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5"
          aria-label="Tài khoản Ops"
        >
          <UserRound className="h-5 w-5" />
        </button>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {capabilities.hasFloorAccess && (
          <button
            onClick={() => navigate("/ops/floor")}
            className="min-h-44 rounded-3xl border border-emerald-300/20 bg-emerald-300/7 p-6 text-left transition hover:bg-emerald-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <Grid3X3 className="h-7 w-7 text-emerald-300" />
            <div className="mt-6 text-xl font-semibold">Floor</div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Giải đấu, bàn, người chơi, đồng hồ và màn hình.</p>
          </button>
        )}
        {capabilities.hasCashierAccess && (
          <button
            onClick={() => navigate("/ops/cashier")}
            className="min-h-44 rounded-3xl border border-amber-300/20 bg-amber-300/7 p-6 text-left transition hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <Banknote className="h-7 w-7 text-amber-300" />
            <div className="mt-6 text-xl font-semibold">Cashier</div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Hàng chờ và các công cụ thu ngân hiện có.</p>
          </button>
        )}
      </div>
    </main>
  );
}
