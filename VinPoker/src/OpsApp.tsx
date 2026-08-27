import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteLoader } from "@/components/RouteLoader";
import OpsShell from "@/components/ops/OpsShell";
import OpsHubShell from "@/components/ops/OpsHubShell";
import { OpsAuthProvider } from "@/ops/auth/OpsAuthProvider";
import { OpsCapabilityProvider } from "@/ops/auth/OpsCapabilityProvider";
import { OpsTournamentScopeGate } from "@/ops/auth/OpsTournamentScopeGate";
import { OpsWorkspaceProvider } from "@/ops/workspace/OpsWorkspaceProvider";
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
const OpsAlertsHub = lazy(() => import("@/ops/pages/OpsAlertsHub"));
const OpsTournaments = lazy(() => import("@/pages/ops/OpsTournaments"));
const OpsTables = lazy(() => import("@/pages/ops/OpsTables"));
const OpsCashier = lazy(() => import("@/pages/ops/OpsCashier"));
const OpsTournamentTv = lazy(() => import("@/pages/ops/OpsTournamentTv"));
const FloorTournamentWorkspace = lazy(() => import("@/ops/floor/FloorTournamentWorkspace"));
const OpsTrackerWorkspace = lazy(() => import("@/ops/tracker/OpsTrackerWorkspace"));
const OpsDealerControlWorkspace = lazy(() => import("@/ops/dealer-control/OpsDealerControlWorkspace"));
const OpsChipOpsWorkspace = lazy(() => import("@/ops/chip-ops/OpsChipOpsWorkspace"));
const OpsFinanceWorkspace = lazy(() => import("@/ops/finance/OpsFinanceWorkspace"));
const OpsOwnerDailyDigest = lazy(() => import("@/ops/digest/OpsOwnerDailyDigest"));
const OpsSeriesWorkspace = lazy(() => import("@/ops/series/OpsSeriesWorkspace"));

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
        <OpsWorkspaceProvider>
          <Outlet />
        </OpsWorkspaceProvider>
      </OpsCapabilityProvider>
    </OpsRequireSession>
  );
}

function LegacyTournamentRedirect() {
  const { id } = useParams();
  const location = useLocation();
  return <Navigate to={id ? `/ops/floor/tournaments/${id}/tables${location.search}` : `/ops/floor${location.search}`} replace />;
}

function TournamentRootRedirect() {
  const { id } = useParams();
  const location = useLocation();
  return <Navigate to={id ? `/ops/floor/tournaments/${id}/tables${location.search}` : `/ops/floor${location.search}`} replace />;
}

function FloorTournamentRoute({ section }: { section: "tables" | "players" | "clock" | "payout" | "screens" }) {
  return (
    <OpsModuleGate capability="floor">
      <OpsTournamentScopeGate>
        <FloorTournamentWorkspace section={section} />
      </OpsTournamentScopeGate>
    </OpsModuleGate>
  );
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
                    <Route element={<OpsHubShell />}>
                      <Route path="/ops/select-module" element={<OpsSelectModule />} />
                      <Route path="/ops/spaces" element={<Navigate to="/ops/select-module?view=spaces" replace />} />
                      <Route path="/ops/alerts" element={<OpsAlertsHub />} />
                      <Route path="/ops/account" element={<OpsAccount />} />
                    </Route>
                    <Route
                      path="/ops/floor/tournaments/:id/tv"
                      element={(
                        <OpsModuleGate capability="floor">
                          <OpsTournamentScopeGate>
                            <OpsTournamentTv />
                          </OpsTournamentScopeGate>
                        </OpsModuleGate>
                      )}
                    />
                    <Route element={<OpsShell />}>
                      <Route
                        path="/ops/club-admin/accounts"
                        element={<OpsModuleGate capability="club-admin"><OpsClubAccounts /></OpsModuleGate>}
                      />
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
                        element={<TournamentRootRedirect />}
                      />
                      <Route path="/ops/floor/tournaments/:id/tables" element={<FloorTournamentRoute section="tables" />} />
                      <Route path="/ops/floor/tournaments/:id/players" element={<FloorTournamentRoute section="players" />} />
                      <Route path="/ops/floor/tournaments/:id/clock" element={<FloorTournamentRoute section="clock" />} />
                      <Route path="/ops/floor/tournaments/:id/payout" element={<FloorTournamentRoute section="payout" />} />
                      <Route path="/ops/floor/tournaments/:id/screens" element={<FloorTournamentRoute section="screens" />} />
                      <Route
                        path="/ops/cashier"
                        element={<OpsModuleGate capability="cashier"><OpsCashier /></OpsModuleGate>}
                      />
                      <Route path="/ops/tracker" element={<OpsModuleGate capability="tracker"><OpsTrackerWorkspace /></OpsModuleGate>} />
                      <Route path="/ops/dealer-swing" element={<OpsModuleGate capability="dealer-control"><OpsDealerControlWorkspace /></OpsModuleGate>} />
                      <Route path="/ops/fnb" element={<OpsModuleGate capability="fnb" />} />
                      <Route path="/ops/fnb/counter" element={<OpsModuleGate capability="fnb" />} />
                      <Route path="/ops/fnb/serve" element={<OpsModuleGate capability="fnb" />} />
                      <Route path="/ops/fnb/kitchen" element={<OpsModuleGate capability="fnb" />} />
                      <Route path="/ops/fnb/admin" element={<OpsModuleGate capability="fnb" />} />
                      <Route path="/ops/marketing" element={<OpsModuleGate capability="marketing" />} />
                      <Route path="/ops/chip-ops" element={<OpsModuleGate capability="chip-ops"><OpsChipOpsWorkspace /></OpsModuleGate>} />
                      <Route path="/ops/daily-digest" element={<OpsModuleGate capability="daily-digest"><OpsOwnerDailyDigest /></OpsModuleGate>} />
                      <Route path="/ops/finance" element={<OpsModuleGate capability="finance"><OpsFinanceWorkspace /></OpsModuleGate>} />
                      <Route path="/ops/accountant" element={<OpsModuleGate capability="accountant" />} />
                      <Route path="/ops/series" element={<OpsModuleGate capability="series"><OpsSeriesWorkspace /></OpsModuleGate>} />
                      <Route path="/ops/accounting" element={<Navigate to="/ops/finance" replace />} />
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
