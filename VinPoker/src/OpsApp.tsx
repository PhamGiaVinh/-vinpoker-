import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteLoader } from "@/components/RouteLoader";
import OpsShell from "@/components/ops/OpsShell";
import { OpsAuthProvider } from "@/ops/auth/OpsAuthProvider";
import { OpsCapabilityProvider } from "@/ops/auth/OpsCapabilityProvider";
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
const OpsSelectModule = lazy(() => import("@/ops/pages/OpsSelectModule"));
const OpsCashier = lazy(() => import("@/pages/ops/OpsCashier"));
const FloorTournamentList = lazy(() => import("@/ops/floor/FloorTournamentList"));
const FloorTournamentLayout = lazy(() => import("@/ops/floor/FloorTournamentLayout"));
const TablesWorkspace = lazy(() => import("@/ops/floor/TablesWorkspace"));
const PlayersWorkspace = lazy(() => import("@/ops/floor/PlayersWorkspace"));
const ClockWorkspace = lazy(() => import("@/ops/floor/ClockWorkspace"));
const PayoutWorkspace = lazy(() => import("@/ops/floor/PayoutWorkspace"));
const ScreensWorkspace = lazy(() => import("@/ops/floor/ScreensWorkspace"));

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
  return <Navigate to={id ? `/ops/floor/tournaments/${id}/tables` : "/ops/floor"} replace />;
}

export default function OpsApp() {
  return (
    <QueryClientProvider client={opsQueryClient}>
      <TooltipProvider>
        <Toaster theme="dark" position="top-center" />
        <BrowserRouter>
          <OpsAuthProvider>
            <Suspense fallback={<RouteLoader />}>
              <Routes>
                <Route path="/ops/login" element={<OpsLogin />} />
                <Route path="/ops/auth/callback" element={<OpsAuthCallback />} />
                <Route path="/ops/forgot-password" element={<OpsForgotPassword />} />
                <Route element={<ProtectedOpsRoot />}>
                  <Route path="/ops" element={<OpsEntryResolver />} />
                  <Route path="/ops/select-module" element={<OpsSelectModule />} />
                  <Route path="/ops/account" element={<OpsAccount />} />
                  <Route element={<OpsShell />}>
                    <Route
                      path="/ops/floor"
                      element={<OpsModuleGate capability="floor"><FloorTournamentList /></OpsModuleGate>}
                    />
                    <Route
                      path="/ops/floor/tables"
                      element={<Navigate to="/ops/floor" replace />}
                    />
                    <Route
                      path="/ops/floor/tournaments/:id"
                      element={(
                        <OpsModuleGate capability="floor">
                          <OpsTournamentScopeGate>
                            <FloorTournamentLayout />
                          </OpsTournamentScopeGate>
                        </OpsModuleGate>
                      )}
                    >
                      <Route index element={<Navigate to="tables" replace />} />
                      <Route path="tables" element={<TablesWorkspace />} />
                      <Route path="players" element={<PlayersWorkspace />} />
                      <Route path="clock" element={<ClockWorkspace />} />
                      <Route path="payout" element={<PayoutWorkspace />} />
                      <Route path="screens" element={<ScreensWorkspace />} />
                    </Route>
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
          </OpsAuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
