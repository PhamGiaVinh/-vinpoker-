import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import type { QuantDraftQ1, QuantSourceReceiptsQ1 } from "./opsQuantDashboardQ1";
import { Activity, Database, RadioTower } from "lucide-react";
import { OpsIntelligenceCommandCenterV1 } from "./OpsIntelligenceCommandCenterV1";
import { OpsQuantDashboardQ1View } from "./OpsQuantDashboardQ1View";
import { OpsQuantDataHealthQ0Panel } from "./OpsQuantDataHealthQ0Panel";

type WorkspaceTab = "quant" | "live" | "health";

export function OpsIntelligenceWorkspaceQ1({ clubId, clubName }: { clubId: string; clubName: string | null }) {
  const { user } = useOpsAuth();
  const identity = `${user?.id ?? "anonymous"}:${clubId}`;
  const [mountedIdentity, setMountedIdentity] = useState(identity);
  useEffect(() => setMountedIdentity(identity), [identity]);
  // Unmount the previous scope (including its cache) before mounting new readers.
  if (mountedIdentity !== identity || !user) return null;
  return <Workspace key={identity} clubId={clubId} clubName={clubName} />;
}

function Workspace({ clubId, clubName }: { clubId: string; clubName: string | null }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WorkspaceTab>("quant");
  const [draft, setDraft] = useState<QuantDraftQ1>({ requestedEventId: null, seatsPerTable: "", customEntries: "", customGtd: "", customPeakConcurrentPlayers: "" });
  const [receipts, setReceipts] = useState<QuantSourceReceiptsQ1>({});
  useEffect(() => () => {
    // A club/user change must not reuse observations accepted for the previous scope.
    void queryClient.cancelQueries({ queryKey: ["ops", clubId] });
    queryClient.removeQueries({ queryKey: ["ops", clubId] });
  }, [clubId, queryClient]);
  return <main className="space-y-3" data-testid="ops-intelligence-workspace-q1">
    <header className="border border-cyan-300/15 bg-[#050b0d] px-4 pt-3 shadow-[0_0_36px_rgba(34,211,238,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">VinPoker Quant Operations Terminal</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Demand · Capacity · Economics · Confidence</h1>
          <p className="mt-1 text-xs text-[#778b86]">{clubName ?? "CLB đã xác thực"} · Owner/Super Admin · Read-only</p>
        </div>
        <span className="border border-emerald-300/25 bg-emerald-400/5 px-2 py-1 font-mono text-[10px] text-emerald-200">READ-ONLY</span>
      </div>
      <nav className="flex gap-5 border-t border-white/8" aria-label="Chế độ Quant Operations">
        <TabButton active={tab === "quant"} icon={<Activity className="h-3.5 w-3.5" />} label="QUANT" onClick={() => setTab("quant")} />
        <TabButton active={tab === "live"} icon={<RadioTower className="h-3.5 w-3.5" />} label="LIVE OPS" onClick={() => setTab("live")} />
        <TabButton active={tab === "health"} icon={<Database className="h-3.5 w-3.5" />} label="DATA HEALTH" onClick={() => setTab("health")} />
      </nav>
    </header>
    {tab === "quant" && <OpsQuantDashboardQ1View clubId={clubId} clubName={clubName} draft={draft} onDraftChange={setDraft} receipts={receipts} onReceiptsChange={setReceipts} />}
    {tab === "live" && <OpsIntelligenceCommandCenterV1 clubId={clubId} clubName={clubName} embedded showDataHealth={false} />}
    {tab === "health" && <OpsQuantDataHealthQ0Panel clubId={clubId} embedded />}
  </main>;
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={`flex min-h-10 items-center gap-2 border-b-2 px-1 text-[10px] font-semibold tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${active ? "border-cyan-300 text-cyan-200" : "border-transparent text-[#72847f] hover:text-white"}`}>{icon}{label}</button>;
}
