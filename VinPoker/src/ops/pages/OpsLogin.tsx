import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import {
  playerLoginUrlForOpsTarget,
  safeOpsDocumentTarget,
} from "@/ops/auth/opsSharedSessionNavigation";

export default function OpsLogin() {
  const { user, loading } = useOpsAuth();
  const location = useLocation();
  const state = location.state as { from?: unknown } | null;
  const target = safeOpsDocumentTarget(state?.from) ?? "/ops";
  const playerLoginUrl = playerLoginUrlForOpsTarget(target);

  useEffect(() => {
    if (!loading && !user) window.location.replace(playerLoginUrl);
  }, [loading, playerLoginUrl, user]);

  if (!loading && user) return <Navigate to={target} replace />;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-emerald-300/15 bg-[#0d1512] p-6 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-300" />
        <h1 className="mt-4 text-xl font-semibold">Mở VinPoker Ops</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Ops dùng chung phiên đăng nhập với ứng dụng chính.
        </p>
        <a
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-400 px-4 text-sm font-medium text-emerald-950"
          href={playerLoginUrl}
        >
          Đăng nhập ứng dụng chính
        </a>
      </div>
    </main>
  );
}
