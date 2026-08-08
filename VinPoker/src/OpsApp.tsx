import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteLoader } from "@/components/RouteLoader";
import OpsShell from "@/components/ops/OpsShell";
import { OpsAuthProvider } from "@/ops/auth/OpsAuthProvider";
import { OpsCapabilityProvider, useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { OpsTournamentScopeGate } from "@/ops/auth/OpsTournamentScopeGate";
import {
  OpsEntryResolver,
  OpsModuleGate,
  OpsRequireSession,
} from "@/ops/pages/OpsEntryResolver";

const OpsLogin = lazy(() => import("@/ops/pages/OpsLogin"));
const OpsAuthCallback = lazy(() => import("@/ops/pages/OpsAuthCallback"));
const OpsForgotPassword = lazy(() => import("@/ops/pages/OpsForgotPassword"));
const OpsAccount = lazy(() => import("@/ops/pages/OpsAccount"));
const OpsClubAccounts = lazy(() => import("@/ops/pages/OpsClubAccounts"));
const OpsSelectModule = lazy(() => import("@/ops/pages/OpsSelectModule"));
const OpsTournaments = lazy(() => import("@/pages/ops/OpsTournaments"));
const OpsTournamentCockpit = lazy(() => import("@/pages/ops/OpsTournamentCockpit"));
const OpsTables = lazy(() => import("@/pages/ops/OpsTables"));
const OpsCashier = lazy(() => import("@/pages/ops/OpsCashier"));

const opsQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function ProtectedOpsRoot() {
  return (
    <OpsRequireSession>
      <OpsCapabilityProvider>
        <Outlet />
      </OpsCapabilityProvider>
    </OpsRequireSession>
  );
}

function LegacyTournamentRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/ops/floor/tournaments/${id}` : "/ops/floor"} replace />;
}

function OpsOwnerGate({ children }: { children: ReactNode }) {
  const capabilities = useOpsCapabilities();
  if (capabilities.loading) return <RouteLoader />;
  return capabilities.hasOwnerAccess ? <>{children}</> : <Navigate to="/ops" replace />;
}

export default function OpsApp() {
  return (
    <QueryClientProvider client={opsQueryClient}>
      <TooltipProvider>
        <Toaster theme="dark" position="top-center" />
        <BrowserRouter>
          <OpsAuthProvider>
            <div className="ops-root min-h-[100dvh] bg-[#030604] text-[#f2ece6]">
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                <Route path="/ops/login" element={<OpsLogin />} />
                <Route path="/ops/auth/callback" element={<OpsAuthCallback />} />
                <Route path="/ops/forgot-password" element={<OpsForgotPassword />} />
                <Route element={<ProtectedOpsRoot />}>
                  <Route path="/ops" element={<OpsEntryResolver />} />
                  <Route path="/ops/select-module" element={<OpsSelectModule />} />
                  <Route path="/ops/account" element={<OpsAccount />} />
                  <Route path="/ops/club-admin/accounts" element={<OpsOwnerGate><OpsClubAccounts /></OpsOwnerGate>} />
                  <Route element={<OpsShell />}>
                    <Route
                      path="/ops/floor"
                      element={<OpsModuleGate capability="floor"><OpsTournaments /></OpsModuleGate>}
                    />
                    <Route
                      path="/ops/floor/tables"
                      element={<OpsModuleGate capability="floor"><OpsTables /></OpsModuleGate>}
                    />
                    <Route
                      path="/ops/floor/tournaments/:id"
                      element={(
                        <OpsModuleGate capability="floor">
                          <OpsTournamentScopeGate>
                            <OpsTournamentCockpit />
                          </OpsTournamentScopeGate>
                        </OpsModuleGate>
                      )}
                    />
                    <Route
                      path="/ops/cashier"
                      element={<OpsModuleGate capability="cashier"><OpsCashier /></OpsModuleGate>}
                    />
                    <Route path="/ops/tournaments" element={<Navigate to="/ops/floor" replace />} />
                    <Route path="/ops/tournaments/:id" element={<LegacyTournamentRedirect />} />
                    <Route path="/ops/tables" element={<Navigate to="/ops/floor" replace />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/ops" replace />} />
                </Routes>
              </Suspense>
            </div>
          </OpsAuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
