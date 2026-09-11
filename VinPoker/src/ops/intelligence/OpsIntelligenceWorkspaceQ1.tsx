import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import type { QuantDraftQ1, QuantSourceReceiptsQ1 } from "./opsQuantDashboardQ1";
import { Activity, Database, LayoutDashboard, RadioTower, RefreshCw } from "lucide-react";
import { OpsIntelligenceCommandCenterV1 } from "./OpsIntelligenceCommandCenterV1";
import { OpsQuantDashboardQ1View } from "./OpsQuantDashboardQ1View";
import { OpsQuantDataHealthQ0Panel } from "./OpsQuantDataHealthQ0Panel";
import { OpsIntelligenceOverviewV1 } from "./OpsIntelligenceOverviewView";
import { contextQueryOptions } from "./opsIntelligenceContextQuery";
import { resolveIntelligenceScope, scopeForTournament, scopeKey, type OpsIntelligenceScopeV1 } from "./opsIntelligenceContextV1";
import type { IntelligenceTabV1 } from "./opsIntelligenceOverviewV1";

const EMPTY_DRAFT: QuantDraftQ1 = { seatsPerTable: "", customEntries: "", customGtd: "", customPeakConcurrentPlayers: "" };

export function OpsIntelligenceWorkspaceQ1({ clubId, clubName }: { clubId: string; clubName: string | null }) {
  const { user } = useOpsAuth();
  const queryClient = useQueryClient();
  const identity = `${user?.id ?? "anonymous"}:${clubId}`;
  const [mountedIdentity, setMountedIdentity] = useState<string | null>(null);
  const previousClub = useRef(clubId);
  const lifecycle = useRef(0);
  useEffect(() => {
    if (mountedIdentity === identity) return;
    // Shared Ops keys are club-scoped, not actor-scoped: neither tenant cache
    // may survive an identity transition, including a prefilled first mount.
    for (const scopedClub of new Set([previousClub.current, clubId])) {
      void queryClient.cancelQueries({ queryKey: ["ops", scopedClub] });
      queryClient.removeQueries({ queryKey: ["ops", scopedClub] });
    }
    previousClub.current = clubId;
    setMountedIdentity(identity);
  }, [identity, mountedIdentity, clubId, queryClient]);
  useEffect(() => {
    const generation = ++lifecycle.current;
    const isCurrentLifecycle = () => generation === lifecycle.current;
    return () => {
      // StrictMode's immediate effect replay is not a workspace exit.
      queueMicrotask(() => {
        if (!isCurrentLifecycle()) return;
        void queryClient.cancelQueries({ queryKey: ["ops", clubId] });
        queryClient.removeQueries({ queryKey: ["ops", clubId] });
      });
    };
  }, [clubId, queryClient]);
  // Unmount the previous scope (including its cache) before mounting new readers.
  if (mountedIdentity !== identity || !user) return null;
  return <Workspace key={identity} clubId={clubId} clubName={clubName} />;
}

function Workspace({ clubId, clubName }: { clubId: string; clubName: string | null }) {
  const client = useSupabaseClient();
  const context = useQuery(contextQueryOptions(client, clubId));
  const inventory = context.isError ? null : context.data?.value ?? null;
  const [tab, setTab] = useState<IntelligenceTabV1>("overview");
  const [scope, setScope] = useState<OpsIntelligenceScopeV1>({ kind: "club" });
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuantDraftQ1>(EMPTY_DRAFT);
  const [receipts, setReceipts] = useState<QuantSourceReceiptsQ1>({});
  const resolved = resolveIntelligenceScope(inventory, scope);
  const options: { label: string; scope: OpsIntelligenceScopeV1 }[] = [{ label: "Toàn CLB", scope: { kind: "club" } }];
  for (const row of inventory?.dailyTournaments ?? []) options.push({ label: `Daily · ${row.name}`, scope: { kind: "daily", tournamentId: row.tournamentId } });
  for (const festival of inventory?.festivals ?? []) {
    options.push({ label: `Festival · ${festival.name}`, scope: { kind: "festival", festivalId: festival.festivalId } });
    for (const child of festival.tournaments) if (child.phase === "flight" || child.phase === "final") options.push({ label: `${festival.name} → ${child.phase === "final" ? "Final" : child.flightLabel ?? "Flight chưa có nhãn"} · ${child.name}`, scope: { kind: child.phase, festivalId: festival.festivalId, tournamentId: child.tournamentId } });
  }
  const navigate = (next: OpsIntelligenceScopeV1, nextTab: IntelligenceTabV1) => {
    if (scopeKey(next) !== scopeKey(scope)) {
      if (!resolveIntelligenceScope(inventory, next).valid) { setScopeError("Phạm vi không còn thuộc nguồn CLB đã xác minh."); return; }
      if (Object.values(draft).some(Boolean) && !window.confirm("Đổi phạm vi sẽ xóa giả định Custom chưa lưu. Tiếp tục?")) return;
      setDraft(EMPTY_DRAFT);
      setScope(next);
    }
    setScopeError(null);
    setTab(nextTab);
  };
  const selectTournament = (tournamentId: string) => {
    const next = inventory && scopeForTournament(inventory, tournamentId);
    if (!next) { setScopeError("Giải này chưa có liên kết / vai trò xác minh trong nguồn phạm vi."); return; }
    navigate(next, "quant");
  };
  return <main className="space-y-3" data-testid="ops-intelligence-workspace-q1">
    <header className="border border-cyan-300/15 bg-[#050b0d] px-4 pt-3 shadow-[0_0_36px_rgba(34,211,238,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-[13px] font-semibold text-cyan-300">VINPOKER OPERATIONS INTELLIGENCE</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Vận hành · Nhu cầu · Nguồn lực · Kinh tế · Dữ liệu</h1>
          <p className="mt-1 text-[13px] text-[#a1b4ad]">{clubName ?? "CLB đã xác thực"} · Owner/Super Admin · Chỉ đọc</p>
        </div>
        <span className="border border-emerald-300/25 bg-emerald-400/5 px-2 py-1 font-mono text-[10px] text-emerald-200">READ-ONLY</span>
      </div>
      <div className="flex items-end gap-3 border-t border-white/10 py-3">
        <label className="min-w-0 flex-1 text-[13px] text-[#a1b4ad]">Phạm vi
          <select aria-label="Phạm vi Intelligence" value={scopeKey(scope)} onChange={(event) => { const option = options.find((item) => scopeKey(item.scope) === event.target.value); if (option) navigate(option.scope, tab); }} disabled={!inventory} className="mt-1 block h-10 w-full rounded-[4px] border border-white/15 bg-[#0b1518] px-3 text-sm text-white focus-visible:outline-cyan-300">
            {!options.some((item) => scopeKey(item.scope) === scopeKey(scope)) && <option value={scopeKey(scope)}>Phạm vi đã chọn chưa khả dụng</option>}
            {options.map((item) => <option key={scopeKey(item.scope)} value={scopeKey(item.scope)}>{item.label}</option>)}
          </select>
        </label>
        <button type="button" title="Đọc lại nguồn phạm vi" aria-label="Đọc lại nguồn phạm vi" onClick={() => void context.refetch()} className="flex h-10 w-10 items-center justify-center rounded-[4px] border border-white/15 text-cyan-200 focus-visible:outline"><RefreshCw className="h-4 w-4" /></button>
        <div className="max-w-[280px] text-xs text-[#a1b4ad]">{context.isPending ? "Đang đọc phạm vi…" : context.isError ? "Nguồn phạm vi chưa đọc được" : "Nguồn phạm vi EXACT"}<br />Source asOf: {inventory?.asOf ?? "Chưa có"}<br />Đọc thành công: {context.data?.observedAt ?? "Chưa có"}</div>
      </div>
      <nav className="flex gap-5 border-t border-white/8" aria-label="Chế độ Intelligence">
        <TabButton active={tab === "overview"} icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="TỔNG QUAN" onClick={() => setTab("overview")} />
        <TabButton active={tab === "quant"} icon={<Activity className="h-3.5 w-3.5" />} label="QUANT" onClick={() => setTab("quant")} />
        <TabButton active={tab === "live"} icon={<RadioTower className="h-3.5 w-3.5" />} label="LIVE OPS" onClick={() => setTab("live")} />
        <TabButton active={tab === "health"} icon={<Database className="h-3.5 w-3.5" />} label="DATA HEALTH" onClick={() => setTab("health")} />
      </nav>
    </header>
    {scopeError && <p role="alert" className="border border-amber-300/25 p-3 text-sm text-amber-100">{scopeError}</p>}
    {(tab === "live" || tab === "health") && <p className="border-l-2 border-cyan-300/30 px-3 py-2 text-sm text-[#a1b4ad]">Dữ liệu tab này ở phạm vi toàn CLB. Phạm vi đang chọn được giữ cho Tổng quan và Quant.</p>}
    {tab === "overview" && <OpsIntelligenceOverviewV1 clubId={clubId} scope={scope} context={context.isError ? null : context.data ?? null} contextReason={context.isError ? "CONTEXT_READ_UNAVAILABLE" : null} onRetryContext={() => void context.refetch()} navigate={navigate} receipts={receipts} onReceiptsChange={setReceipts} />}
    {tab === "quant" && <OpsQuantDashboardQ1View clubId={clubId} clubName={clubName} requestedTournamentId={resolved.tournamentId} onTournamentChange={selectTournament} draft={draft} onDraftChange={setDraft} receipts={receipts} onReceiptsChange={setReceipts} />}
    {tab === "live" && <OpsIntelligenceCommandCenterV1 clubId={clubId} clubName={clubName} embedded showDataHealth={false} />}
    {tab === "health" && <OpsQuantDataHealthQ0Panel clubId={clubId} embedded />}
  </main>;
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={`flex min-h-10 items-center gap-2 border-b-2 px-1 text-[10px] font-semibold tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${active ? "border-cyan-300 text-cyan-200" : "border-transparent text-[#72847f] hover:text-white"}`}>{icon}{label}</button>;
}
