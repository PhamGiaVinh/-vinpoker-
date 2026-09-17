import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AwardInput = { position: string; ticketCount: string; cashVnd: string };
type Target = { id: string; name: string; start_time: string };
type Candidate = { playerId: string; displayName: string };
type IssuedTicket = { serial: number; code: string; position: number; winnerPlayerId: string; status: string };
type Issuance = { ok: true; issued: boolean; ticketTotal?: number; tickets?: IssuedTicket[]; results?: { position: number; playerId: string }[] };
type AwardPlan = {
  ok: true;
  locked: boolean;
  targetTournamentId?: string;
  targetEntryPriceVnd?: string;
  ticketTotal?: number;
  cashTotalVnd?: string;
  totalLiabilityVnd?: string;
  awardLines?: { position: number; ticketCount: number; cashVnd: string }[];
  lockedAt?: string;
};

const emptyRow = (): AwardInput => ({ position: "", ticketCount: "0", cashVnd: "0" });
const planRpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>;
const money = (value?: string) => value && /^\d{1,16}$/.test(value)
  ? `${Number(value).toLocaleString("en-US")} VND` : "—";

function parsePlan(raw: unknown): AwardPlan {
  if (!raw || typeof raw !== "object") throw new Error("Invalid award-plan response");
  const plan = raw as AwardPlan;
  if (plan.ok !== true || typeof plan.locked !== "boolean") throw new Error("Invalid award-plan response");
  if (plan.locked || plan.targetTournamentId) {
    if (!plan.targetTournamentId || !/^\d{1,16}$/.test(plan.targetEntryPriceVnd ?? "")
      || !/^\d{1,16}$/.test(plan.cashTotalVnd ?? "")
      || !/^\d{1,16}$/.test(plan.totalLiabilityVnd ?? "")
      || !Number.isInteger(plan.ticketTotal) || !Array.isArray(plan.awardLines)) {
      throw new Error("Incomplete award-plan response");
    }
  }
  return plan;
}

function parseIssuance(raw: unknown): Issuance {
  if (!raw || typeof raw !== "object") throw new Error("Invalid ticket-ledger response");
  const value = raw as Issuance;
  if (value.ok !== true || typeof value.issued !== "boolean"
    || (value.issued && (!Array.isArray(value.tickets) || !Number.isInteger(value.ticketTotal)
      || value.tickets.length !== value.ticketTotal))) {
    throw new Error("Incomplete ticket-ledger response");
  }
  return value;
}

/** Satellite-only TD surface. Redemption is a separate Cashier server workflow. */
export function SatelliteAwardPlanPanel({ tournamentId, clubId }: { tournamentId: string; clubId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [locked, setLocked] = useState<AwardPlan | null>(null);
  const [targetId, setTargetId] = useState("");
  const [rows, setRows] = useState<AwardInput[]>([{ position: "1", ticketCount: "1", cashVnd: "0" }]);
  const [preview, setPreview] = useState<{ plan: AwardPlan; input: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [issuance, setIssuance] = useState<Issuance | null>(null);
  const [recipients, setRecipients] = useState<Record<number, string>>({});
  const [issueConfirmed, setIssueConfirmed] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const request = ++seq.current;
    setLoading(true);
    setLoadError(null);
    setPreview(null);
    try {
      const [planResult, targetsResult, issuanceResult, candidatesResult] = await Promise.all([
        planRpc("satellite_get_award_plan_v1", { p_source_tournament_id: tournamentId }),
        supabase.from("tournaments")
          .select("id,name,start_time")
          .eq("club_id", clubId).eq("operations_mode", "standard")
          .in("status", ["scheduled", "live"])
          .is("registration_closed_at", null).neq("id", tournamentId)
          .order("start_time", { ascending: true }),
        planRpc("satellite_get_issuance_v1", { p_source_tournament_id: tournamentId }),
        planRpc("satellite_get_award_candidates_v1", { p_source_tournament_id: tournamentId }),
      ]);
      if (request !== seq.current) return;
      if (planResult.error || targetsResult.error || issuanceResult.error || candidatesResult.error) {
        throw new Error(planResult.error?.message || targetsResult.error?.message
          || issuanceResult.error?.message || candidatesResult.error?.message || "Could not load Satellite setup");
      }
      const plan = parsePlan(planResult.data);
      setLocked(plan.locked ? plan : null);
      setTargets((targetsResult.data ?? []) as Target[]);
      const currentIssuance = parseIssuance(issuanceResult.data);
      setIssuance(currentIssuance);
      const candidateData = candidatesResult.data as { ok?: boolean; players?: Candidate[] } | null;
      if (candidateData?.ok !== true || !Array.isArray(candidateData.players)) throw new Error("Incomplete winner list");
      setCandidates(candidateData.players);
      if (currentIssuance.issued) setIssueError(null);
    } catch (error) {
      if (request === seq.current) setLoadError(error instanceof Error ? error.message : "Could not load Satellite setup");
    } finally {
      if (request === seq.current) setLoading(false);
    }
  }, [clubId, tournamentId]);

  useEffect(() => {
    const sequence = seq;
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  const updateRow = (index: number, patch: Partial<AwardInput>) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setPreview(null);
    setConfirmed(false);
  };
  const input = JSON.stringify({ targetId, rows });
  const previewCurrent = preview?.input === input ? preview.plan : null;

  const submit = async (lock: boolean) => {
    if (busy || !targetId || (lock && (!confirmed || !previewCurrent))) return;
    const awards = rows.map(row => ({
      position: Number(row.position), ticketCount: Number(row.ticketCount), cashVnd: row.cashVnd,
    }));
    if (rows.length < 1 || rows.length > 100 || awards.reduce((sum, row) => sum + row.ticketCount, 0) < 1 || awards.some((row) =>
      !Number.isInteger(row.position) || row.position < 1 || row.position > 99999
      || !Number.isInteger(row.ticketCount) || row.ticketCount < 0 || row.ticketCount > 10
      || !/^\d{1,15}$/.test(row.cashVnd)
      || (row.ticketCount === 0 && Number(row.cashVnd) === 0)
    ) || new Set(awards.map(row => row.position)).size !== awards.length) {
      toast.error("Use unique ranks, 0–10 tickets per rank, and a non-negative cash amount.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await planRpc("satellite_award_plan_v1", {
        p_source_tournament_id: tournamentId,
        p_target_tournament_id: targetId,
        p_awards: awards,
        p_lock: lock,
      });
      if (error) throw error;
      const plan = parsePlan(data);
      if (plan.targetTournamentId !== targetId || plan.locked !== lock) {
        throw new Error("Server award plan did not match the requested action");
      }
      if (lock) {
        setLocked(plan);
        setPreview(null);
        toast.success("Satellite award plan locked");
      } else {
        setPreview({ plan, input });
        setConfirmed(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Satellite award plan");
      if (lock) void load(); // A lost response may still have committed; read before offering another action.
    } finally { setBusy(false); }
  };

  const issue = async () => {
    if (!locked?.awardLines || issuance?.issued || busy || !issueConfirmed) return;
    const results = locked.awardLines.map(line => ({ position: line.position, playerId: recipients[line.position] }));
    if (results.some(row => !row.playerId) || new Set(results.map(row => row.playerId)).size !== results.length) {
      setIssueError("Assign one distinct confirmed player to every ranked award.");
      return;
    }
    setBusy(true);
    setIssueError(null);
    try {
      const { data, error } = await planRpc("satellite_issue_tickets_v1", {
        p_source_tournament_id: tournamentId, p_results: results,
      });
      if (error) throw error;
      const issued = parseIssuance(data);
      if (!issued.issued || issued.ticketTotal !== locked.ticketTotal) throw new Error("Ticket count did not match the locked plan");
      setIssuance(issued);
      toast.success(`${issued.ticketTotal} tickets issued`);
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "Could not issue tickets");
      void load(); // A lost response may still have committed. Re-read the immutable ledger.
    } finally { setBusy(false); }
  };

  if (loading) return <Card className="p-4" role="status">Loading Satellite awards…</Card>;
  if (loadError) return <Card className="space-y-3 p-4"><p role="alert" className="text-destructive">{loadError}</p><Button variant="outline" onClick={() => void load()}>Retry</Button></Card>;

  return <Card className="space-y-4 p-4 border-amber-500/30">
    <div className="flex items-start gap-2"><Ticket className="mt-0.5 h-5 w-5 text-amber-400" /><div><h2 className="font-semibold">Satellite award plan</h2><p className="text-xs text-muted-foreground">TD locks ticket ranks and cash prizes before results close. This does not issue or redeem tickets.</p></div></div>
    {locked ? <div className="space-y-3" role="status">
      <p className="text-sm text-primary">Locked{locked.lockedAt ? ` · ${new Date(locked.lockedAt).toLocaleString()}` : ""}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Exact target</dt><dd>{targets.find(t => t.id === locked.targetTournamentId)?.name ?? locked.targetTournamentId}</dd></div><div><dt className="text-muted-foreground">Ticket value · buy-in + fees</dt><dd>{money(locked.targetEntryPriceVnd)}</dd></div><div><dt className="text-muted-foreground">Tickets to issue</dt><dd>{locked.ticketTotal}</dd></div><div><dt className="text-muted-foreground">Cash owed</dt><dd>{money(locked.cashTotalVnd)}</dd></div></dl>
      <p className="text-xs text-muted-foreground">Total ticket + cash obligation: {money(locked.totalLiabilityVnd)}. Issuance, redemption, and pool reconciliation are separate server steps.</p>
      <div className="space-y-3 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Ticket issuance</h3>
        {issuance?.issued ? <div role="status" className="space-y-2"><p className="text-sm text-emerald-400">Issued {issuance.ticketTotal} / {locked.ticketTotal} tickets</p>
          <p className="text-xs text-muted-foreground">Serials are for reconciliation; redemption codes are private. Never display this list on the tournament TV.</p>
          <div className="max-h-64 space-y-2 overflow-auto">{issuance.tickets?.map(ticket => <div key={ticket.serial} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border p-2 text-xs"><strong>#{ticket.serial}</strong><span>Rank {ticket.position}</span><span>{candidates.find(c => c.playerId === ticket.winnerPlayerId)?.displayName ?? ticket.winnerPlayerId}</span><span>{ticket.status}</span><code className="break-all select-all">{ticket.code}</code></div>)}</div>
        </div> : <>
          <p className="text-xs text-muted-foreground">After the source tour is closed, assign each prize rank to its confirmed winner. Ticket value includes the target buy-in and all fees. Issuing is permanent.</p>
          {locked.awardLines?.map(line => <div key={line.position} className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center"><Label htmlFor={`winner-${line.position}`}>Rank {line.position} · {line.ticketCount} ticket{line.ticketCount === 1 ? "" : "s"}</Label><Select value={recipients[line.position] ?? ""} onValueChange={value => { setRecipients(current => ({ ...current, [line.position]: value })); setIssueConfirmed(false); setIssueError(null); }}><SelectTrigger id={`winner-${line.position}`}><SelectValue placeholder="Select confirmed player" /></SelectTrigger><SelectContent>{candidates.map(candidate => <SelectItem key={candidate.playerId} value={candidate.playerId}>{candidate.displayName}</SelectItem>)}</SelectContent></Select></div>)}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={issueConfirmed} onChange={e => setIssueConfirmed(e.target.checked)} />I confirm the final ranks, winners, target tour and {locked.ticketTotal} ticket obligations. Cash prizes and pool reconciliation remain separate.</label>
          {issueError && <p role="alert" className="text-sm text-destructive">{issueError}</p>}
          <Button type="button" disabled={busy || !issueConfirmed || candidates.length === 0} onClick={() => void issue()}>Issue tickets</Button>
        </>}
      </div>
    </div> : <>
      <div className="space-y-1"><Label htmlFor="satellite-target">Target tournament</Label><Select value={targetId} onValueChange={value => { setTargetId(value); setPreview(null); setConfirmed(false); }}><SelectTrigger id="satellite-target"><SelectValue placeholder="Select the exact tournament" /></SelectTrigger><SelectContent>{targets.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>{targets.length === 0 && <p className="text-xs text-amber-400">No open target tournament in this club.</p>}</div>
      <div className="space-y-2"><p className="text-sm font-medium">Awards by finishing place</p>{rows.map((row, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:border-0 sm:p-0"><div><Label htmlFor={`sat-rank-${index}`} className="text-xs">Rank</Label><Input id={`sat-rank-${index}`} inputMode="numeric" value={row.position} onChange={e => updateRow(index, { position: e.target.value })} /></div><div><Label htmlFor={`sat-ticket-${index}`} className="text-xs">Tickets</Label><Input id={`sat-ticket-${index}`} inputMode="numeric" value={row.ticketCount} onChange={e => updateRow(index, { ticketCount: e.target.value })} /></div><div><Label htmlFor={`sat-cash-${index}`} className="text-xs">Cash · VND</Label><Input id={`sat-cash-${index}`} inputMode="numeric" value={row.cashVnd} onChange={e => updateRow(index, { cashVnd: e.target.value })} /></div><Button type="button" size="icon" variant="ghost" className="self-end justify-self-end" aria-label={`Remove rank ${index + 1}`} onClick={() => { setRows(current => current.filter((_, i) => i !== index)); setPreview(null); }}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
      <Button type="button" variant="outline" onClick={() => { setRows(current => [...current, emptyRow()]); setPreview(null); }} disabled={rows.length >= 100}><Plus className="mr-1 h-4 w-4" />Add rank</Button>
      <div className="border-t border-border pt-3 space-y-3"><Button type="button" variant="outline" disabled={busy || !targetId} onClick={() => void submit(false)}>Preview obligations</Button>{previewCurrent && <div role="status" className="rounded bg-muted/40 p-3 text-sm"><p>Target entry: {money(previewCurrent.targetEntryPriceVnd)}</p><p>Tickets: {previewCurrent.ticketTotal} · Cash: {money(previewCurrent.cashTotalVnd)}</p><p className="font-semibold">Total obligation: {money(previewCurrent.totalLiabilityVnd)}</p><p className="mt-1 text-xs text-amber-400">Pool and overlay are not reconciled yet. Locking the plan will not issue a ticket.</p></div>}{previewCurrent && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm the ticket target, ranks, and cash amounts. This plan cannot be edited after locking.</label>}<div><Button type="button" disabled={busy || !previewCurrent || !confirmed} onClick={() => void submit(true)}>Lock award plan</Button></div></div>
    </>}
  </Card>;
}
