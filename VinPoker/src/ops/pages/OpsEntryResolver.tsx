import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { resolveOpsEntry } from "@/ops/auth/opsCapabilityRouting";
import type { ReactNode } from "react";

export function OpsRequireSession({ children }: { children: ReactNode }) {
  const { user, loading } = useOpsAuth();
  const location = useLocation();
  if (loading) return <OpsLoading label="Đang kiểm tra phiên Ops…" />;
  if (!user) return <Navigate to="/ops/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function OpsEntryResolver() {
  const capabilities = useOpsCapabilities();
  if (capabilities.loading) return <OpsLoading label="Đang tải quyền vận hành…" />;
  if (capabilities.scopeError) return <OpsAccessDenied message={capabilities.scopeError} />;
  const destination = resolveOpsEntry(capabilities);
  if (destination === "access-denied") {
    return <OpsAccessDenied message="Tài khoản này chưa được cấp quyền Floor hoặc Cashier." />;
  }
  return <Navigate to={destination} replace />;
}

export function OpsModuleGate({
  capability,
  children,
}: {
  capability: "floor" | "cashier";
  children: ReactNode;
}) {
  const capabilities = useOpsCapabilities();
  if (capabilities.loading) return <OpsLoading label="Đang tải quyền vận hành…" />;
  if (capabilities.scopeError) return <OpsAccessDenied message={capabilities.scopeError} />;
  const allowed = capability === "floor"
    ? capabilities.hasFloorAccess
    : capabilities.hasCashierAccess;
  return allowed ? <>{children}</> : <OpsAccessDenied message={`Tài khoản chưa có quyền ${capability === "floor" ? "Floor" : "Cashier"}.`} />;
}

export function OpsAccessDenied({ message }: { message: string }) {
  const { signOutLocal } = useOpsAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const handleSignOut = async () => {
    setSignOutError(await signOutLocal());
  };
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-rose-300/15 bg-[#0d1512] p-6 text-center">
        <ShieldX className="mx-auto h-8 w-8 text-rose-300" />
        <h1 className="mt-4 text-xl font-semibold">Không có quyền vận hành</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{message}</p>
        {signOutError && <p className="mt-3 text-sm text-rose-300">{signOutError}</p>}
        <Button variant="outline" className="mt-5 min-h-11 w-full" onClick={() => void handleSignOut()}>
          Đăng xuất Ops
        </Button>
      </div>
    </main>
  );
}

function OpsLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] text-zinc-300">
      <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
      {label}
    </main>
  );
}
