import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Loader2, Search, ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import type { OpsSuperAdminClub } from "@/ops/auth/opsCapabilityContract";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { OpsIntelligenceCommandCenterV1 } from "./OpsIntelligenceCommandCenterV1";
import { OpsIntelligenceWorkspaceQ1 } from "./OpsIntelligenceWorkspaceQ1";
import { isOpsIntelligenceCommandCenterEnabled } from "./opsIntelligenceGate";
import { isOpsQuantDashboardQ1Enabled } from "./opsQuantDashboardGate";

const DESKTOP_QUERY = "(min-width: 1280px)";

export function OpsIntelligenceEntryGate({ fallback }: { fallback: ReactNode }) {
  const capabilities = useOpsCapabilities();
  const workspace = useOpsWorkspace();
  const [params, setParams] = useSearchParams();
  const desktop = useDesktopMediaQuery(DESKTOP_QUERY);
  const enabled = isOpsIntelligenceCommandCenterEnabled();
  const ownerClubs = useMemo(() => capabilities.scope.filter((row) => row.can_owner), [capabilities.scope]);
  const requestedClubId = params.get("club");
  const spacesOnly = params.get("view") === "spaces";
  const [verifiedClub, setVerifiedClub] = useState<OpsSuperAdminClub | null>(null);
  const [verificationState, setVerificationState] = useState<"idle" | "checking" | "failed">("idle");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<readonly OpsSuperAdminClub[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!capabilities.isSuperAdmin || !requestedClubId) {
      setVerifiedClub(null);
      setVerificationState("idle");
      return;
    }
    const remembered = workspace.verifiedSuperAdminClubs.get(requestedClubId);
    if (remembered) {
      setVerifiedClub(remembered);
      setVerificationState("idle");
      return;
    }
    let cancelled = false;
    setVerifiedClub(null);
    setVerificationState("checking");
    void capabilities.verifySuperAdminClub(requestedClubId).then((club) => {
      if (cancelled) return;
      if (club) {
        workspace.rememberVerifiedSuperAdminClub(club);
        setVerifiedClub(club);
        setVerificationState("idle");
      } else {
        setVerificationState("failed");
      }
    }).catch(() => {
      if (!cancelled) setVerificationState("failed");
    });
    return () => { cancelled = true; };
  }, [capabilities, requestedClubId, workspace]);

  if (!enabled || spacesOnly || !desktop || !capabilities.hasOwnerAccess) return <>{fallback}</>;

  if (!capabilities.isSuperAdmin) {
    if (ownerClubs.length === 0) return <>{fallback}</>;
    if (ownerClubs.length === 1) {
      const clubId = ownerClubs[0].club_id;
      return renderIntelligence(clubId, clubName(capabilities.clubs, clubId));
    }
    const selected = requestedClubId && ownerClubs.some((row) => row.club_id === requestedClubId) ? requestedClubId : null;
    if (!selected) return <OwnerClubPicker clubs={ownerClubs.map((row) => ({ id: row.club_id, name: clubName(capabilities.clubs, row.club_id) }))} onSelect={(clubId) => setClubParam(params, setParams, clubId)} />;
    return renderIntelligence(selected, clubName(capabilities.clubs, selected));
  }

  if (!requestedClubId) return <SuperAdminClubSearch search={search} searching={searching} results={searchResults} onSearch={async () => {
    setSearching(true);
    try { setSearchResults(await capabilities.searchSuperAdminClubs({ search, limit: 12 })); } finally { setSearching(false); }
  }} onChange={setSearch} onSelect={(clubId) => setClubParam(params, setParams, clubId)} />;
  if (verificationState === "checking") return <GateState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Đang xác thực CLB" detail="Chưa có nguồn Intelligence nào được mount trước khi quyền Super Admin được xác minh." />;
  if (!verifiedClub || verificationState === "failed") return <GateState icon={<ShieldAlert className="h-5 w-5" />} title="Không xác thực được CLB yêu cầu" detail="Không đọc dữ liệu vận hành cho đến khi server xác nhận đúng CLB." />;
  return renderIntelligence(verifiedClub.club_id, verifiedClub.club_name);
}

function renderIntelligence(clubId: string, name: string | null): ReactNode {
  return isOpsQuantDashboardQ1Enabled()
    ? <OpsIntelligenceWorkspaceQ1 clubId={clubId} clubName={name} />
    : <OpsIntelligenceCommandCenterV1 clubId={clubId} clubName={name} />;
}

function useDesktopMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function OwnerClubPicker({ clubs, onSelect }: { clubs: readonly { id: string; name: string | null }[]; onSelect: (clubId: string) => void }) {
  return <section className="border border-emerald-300/20 bg-[#07100c] p-5"><div className="flex items-center gap-3"><Building2 className="h-5 w-5 text-emerald-300" /><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Tổng quan điều hành</p><h1 className="mt-1 text-xl font-semibold text-white">Chọn CLB để xem</h1></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{clubs.map((club) => <Button key={club.id} type="button" variant="outline" className="min-h-11 justify-start" onClick={() => onSelect(club.id)}>{club.name ?? club.id}</Button>)}</div></section>;
}

function SuperAdminClubSearch({ search, searching, results, onSearch, onChange, onSelect }: { search: string; searching: boolean; results: readonly OpsSuperAdminClub[]; onSearch: () => void; onChange: (value: string) => void; onSelect: (clubId: string) => void }) {
  return <section className="border border-emerald-300/20 bg-[#07100c] p-5"><div className="flex items-center gap-3"><ShieldAlert className="h-5 w-5 text-emerald-300" /><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Tổng quan điều hành</p><h1 className="mt-1 text-xl font-semibold text-white">Chọn CLB đã được xác thực</h1></div></div><div className="mt-5 flex gap-2"><input value={search} onChange={(event) => onChange(event.target.value)} className="min-h-11 flex-1 border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-emerald-300" placeholder="Tên hoặc mã CLB" /><Button type="button" variant="outline" onClick={onSearch} disabled={searching}><Search className="mr-2 h-4 w-4" />Tìm</Button></div><div className="mt-3 space-y-2">{results.map((club) => <Button key={club.club_id} type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={() => onSelect(club.club_id)}>{club.club_name}</Button>)}</div></section>;
}

function GateState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <section className="border border-white/10 bg-[#07100c] p-6"><div className="flex items-start gap-3 text-[#b9c8c0]"><span className="mt-0.5 text-amber-200">{icon}</span><div><h1 className="text-lg font-semibold text-white">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#91a49b]">{detail}</p></div></div></section>;
}

function clubName(clubs: readonly { id: string; name: string }[], clubId: string): string | null { return clubs.find((club) => club.id === clubId)?.name ?? null; }
function setClubParam(params: URLSearchParams, setParams: (nextInit: URLSearchParams) => void, clubId: string): void { const next = new URLSearchParams(params); next.set("club", clubId); setParams(next); }
