import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FloorRead = {
  releaseEnabled: boolean;
  eventItmPercent: number;
  rules: null | { policy: string; itmPercent: number; day2Percent: number; minCashX: number };
  qualification: null | { sourceHash: string; participationCount: number; lockedAt: string };
  finalization: null | (Payout & { requestId: string; finalizedAt: string });
  correctionRequests: Array<{ requestId: string; kind: string; deltaVnd: number; reason: string; state: string }>;
};
type Bag = { bagId: string; playerId: string; stack: number; version: number };
type Flight = { flightId: string; status: string | null; dayStatus: string | null; validEntries: number; day2Target: number; eligibleBags: Bag[] };
type Qualification = { state: string; sourceHash: string; policy: string; flights: Flight[] };
type Payout = {
  state: string; rulesVersion: string; fundingRevision: string;
  qualificationRevision: string; payoutInputHash: string;
  directPoolVnd: number; transferPoolVnd: number; feesVnd: number;
  recordedOverlayVnd: number; requiredShortfallVnd: number;
  paidPlayerVnd: number; unpaidObligationVnd: number;
  clubRetainedTieVnd: number; unallocatedPoolVnd: number;
  obligations: Array<{ playerId: string; participationId: string; totalVnd: number; paidVnd: number; unpaidVnd: number }>;
  sourceSnapshot: { payments?: Array<{ id: string; playerId: string; amountVnd: number }> };
};
type Postfinal = { revision: string; paidPlayerVnd: number; unpaidObligationVnd: number; unallocatedPoolVnd: number };

const money = (value: number | undefined) => value == null ? "—" : `${Number(value).toLocaleString("en-US")} VND`;
const rpc = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
  const call = supabase.rpc as unknown as (rpcName: string, parameters: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await call(name, args);
  if (error) throw error;
  return data as T;
};
const message = (error: unknown) => {
  const text = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message) : String(error);
  if (/multi_day_payout_recalculate|stale_source|40001/i.test(text)) return "Source changed. Refresh the preview before retrying.";
  if (/owner_required|actor_denied|42501/i.test(text)) return `Owner or club access denied: ${text}`;
  if (/release_off|gate_denied/i.test(text)) return "The Multi-day package is off for this club.";
  return text;
};

export function MultiDayFloorEventPanel({ eventId, onReleaseRead, surface = "design" }: {
  eventId: string; onReleaseRead?: (enabled: boolean) => void; surface?: "design" | "payout";
}) {
  const [read, setRead] = useState<FloorRead | null>(null);
  const [qualification, setQualification] = useState<Qualification | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [postfinal, setPostfinal] = useState<Postfinal | null>(null);
  const [policy, setPolicy] = useState("SELECT_LARGEST");
  const [minCashX, setMinCashX] = useState("1");
  const [selectedBags, setSelectedBags] = useState<string[]>([]);
  const [kind, setKind] = useState("OBLIGATION_DELTA");
  const [participationId, setParticipationId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingIds = useRef(new Map<string, string>());
  const requestId = (key: string) => {
    if (!pendingIds.current.has(key)) pendingIds.current.set(key, crypto.randomUUID());
    return pendingIds.current.get(key)!;
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await rpc<FloorRead>("multi_day_floor_read_v1", { p_event_id: eventId });
      setRead(current);
      onReleaseRead?.(current.releaseEnabled);
      if (current.rules) {
        setPolicy(current.rules.policy);
        setMinCashX(String(current.rules.minCashX));
        const q = await rpc<Qualification>("multi_day_qualification_preview_v1", { p_event_id: eventId });
        setQualification(q);
        if (current.finalization) {
          setPayout(current.finalization);
          setPostfinal(await rpc<Postfinal>("multi_day_payout_postfinal_state_v1", { p_event_id: eventId }));
        } else if (current.qualification) {
          try {
            const p = await rpc<Payout>("multi_day_payout_preview_v1", { p_event_id: eventId });
            setPayout(p);
          } catch (cause) {
            setPayout(null);
            setError(`Payout preview unavailable: ${message(cause)}`);
          }
          setPostfinal(null);
        } else { setPayout(null); setPostfinal(null); }
      } else { setQualification(null); setPayout(null); setPostfinal(null); }
    } catch (cause) {
      // A missing pending RPC means the release migration is not installed;
      // preserve the existing production Floor controls in that case only.
      if (!/multi_day_floor_read_v1|42883/i.test(message(cause))) onReleaseRead?.(true);
      setError(message(cause));
    }
    finally { setLoading(false); }
  }, [eventId, onReleaseRead]);

  useEffect(() => { void refresh(); }, [refresh]);
  const act = async (work: () => Promise<unknown>, success: string, key?: string) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await work(); if (key) pendingIds.current.delete(key); setNotice(success); await refresh(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const toggleBag = (id: string) => setSelectedBags((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const due = qualification?.flights.reduce((sum, flight) => sum + flight.day2Target, 0) ?? 0;
  const lockKey = `lock:${eventId}:${qualification?.sourceHash}:${[...selectedBags].sort().join(",")}`;
  const finalizeKey = `finalize:${eventId}:${payout?.payoutInputHash}`;
  const correctionKey = `correction:${eventId}:${kind}:${participationId}:${paymentId}:${delta}:${reason}:${evidence}:${postfinal?.revision}`;

  return <section aria-label={surface === "design" ? "Verified Multi-day design" : "Verified Multi-day payout"} className="space-y-3 rounded-md border border-border p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">Verified Multi-day {surface === "design" ? "design" : "payout"}</h3>
      <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || busy}>Refresh source</Button>
    </div>
    {loading && <p role="status">Loading server state…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {read && <>
      <p>Package: {read.releaseEnabled ? "Enabled for this club" : "Off for this club"}. Server authorization applies to every action.</p>
      {surface === "design" && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Main Event rules</h4>
        <p>ITM: {read.rules?.itmPercent ?? read.eventItmPercent}% · Day2: {read.rules?.day2Percent ?? read.eventItmPercent}% per flight, rounded up from valid entries. Day2 currently follows the same server percentage as ITM.</p>
        {read.rules ? <p>Policy: {read.rules.policy} · Minimum cash: {read.rules.minCashX}× frozen entry price. Rules locked before the first registration or entry.</p> : <>
          <p>Configure before the first registration or entry. The server freezes these rules.</p>
          <Label htmlFor={`policy-${eventId}`}>Bag selection policy</Label>
          <select id={`policy-${eventId}`} className="w-full rounded border bg-background p-2" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="SELECT_LARGEST">SELECT_LARGEST — largest bag; other bags earn separate minimum cash</option>
            <option value="SUM_STACKS">SUM_STACKS — combine all bags; no extra bag cash</option>
          </select>
          <Label htmlFor={`cash-${eventId}`}>Minimum cash multiplier</Label>
          <Input id={`cash-${eventId}`} type="number" min="0" max="100" step="0.01" value={minCashX} onChange={(e) => setMinCashX(e.target.value)} />
          <Button type="button" disabled={busy || !read.releaseEnabled || !Number.isFinite(Number(minCashX))} onClick={() => void act(() => rpc("multi_day_set_qualification_rules_v1", { p_event_id: eventId, p_policy: policy, p_min_cash_x: Number(minCashX) }), "Rules saved and frozen.")}>Lock rules</Button>
        </>}
      </div>}
      {surface === "design" && qualification && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Qualification: {read.qualification ? "Locked" : qualification.state === "READY" ? "Ready to lock" : "Planned"}</h4>
        <p className="break-all text-xs">Source revision: {read.qualification?.sourceHash ?? qualification.sourceHash}</p>
        {qualification.flights.map((flight) => <div key={flight.flightId} className="rounded border p-2">
          <p className="font-medium">Flight {flight.flightId.slice(0, 8)} · play {flight.status ?? "not ended"} · bagging {flight.dayStatus ?? "not locked"}</p>
          <p>{flight.validEntries} valid entries → Day2 target {flight.day2Target} (ceil) · {flight.eligibleBags.length} eligible sealed bags</p>
          {!read.qualification && qualification.state === "READY" && flight.eligibleBags.map((bag) => <label key={bag.bagId} className="flex items-center gap-2 py-1">
            <input type="checkbox" checked={selectedBags.includes(bag.bagId)} onChange={() => toggleBag(bag.bagId)} />
            Player {bag.playerId.slice(0, 8)} · {Number(bag.stack).toLocaleString("en-US")} chips · sealed version {bag.version}
          </label>)}
        </div>)}
        {!read.qualification && <Button type="button" disabled={busy || qualification.state !== "READY" || selectedBags.length !== due || !read.releaseEnabled}
          onClick={() => void act(() => rpc("multi_day_lock_qualification_v1", { p_event_id: eventId, p_bag_ids: selectedBags, p_expected_source_hash: qualification.sourceHash, p_request_id: requestId(lockKey) }), "Qualification locked from sealed bags.", lockKey)}>Lock qualification ({selectedBags.length}/{due})</Button>}
      </div>}
      {surface === "payout" && read.qualification && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Final Day payout</h4>
        {!payout ? <p>Payout preview is not ready. Finish results and reconcile funding, then refresh source.</p> : <>
          <p>State: {payout.state}. Preview is server-derived; no ICM or deal calculation.</p>
          <div className="grid gap-1 sm:grid-cols-2">
            <p>Direct pool: {money(payout.directPoolVnd)}</p><p>Redeemed ticket transfers: {money(payout.transferPoolVnd)}</p>
            <p>Fees (outside pool): {money(payout.feesVnd)}</p><p>Recorded overlay: {money(payout.recordedOverlayVnd)}</p>
            <p>Required shortfall (not funded): {money(payout.requiredShortfallVnd)}</p><p>Paid players: {money(payout.paidPlayerVnd)}</p>
            <p>Unpaid obligations: {money(payout.unpaidObligationVnd)}</p><p>Club-retained tie remainder: {money(payout.clubRetainedTieVnd)}</p>
            <p>Unallocated pool: {money(payout.unallocatedPoolVnd)}</p>
          </div>
          <div className="space-y-1 break-all text-xs text-muted-foreground">
            <p>Rules revision: {payout.rulesVersion}</p><p>Funding revision: {payout.fundingRevision}</p>
            <p>Qualification revision: {payout.qualificationRevision}</p><p>Payout input hash: {payout.payoutInputHash}</p>
          </div>
          {!read.finalization && <Button type="button" disabled={busy || payout.state !== "READY" || payout.requiredShortfallVnd !== 0 || !read.releaseEnabled}
            onClick={() => void act(() => rpc("multi_day_finalize_payout_v1", { p_event_id: eventId, p_expected_rules_version: payout.rulesVersion, p_expected_funding_revision: payout.fundingRevision, p_expected_qualification_revision: payout.qualificationRevision, p_expected_payout_input_hash: payout.payoutInputHash, p_request_id: requestId(finalizeKey) }), "Payout obligations finalized. No payment was executed.", finalizeKey)}>Finalize obligations</Button>}
        </>}
        {read.finalization && postfinal && <div className="space-y-2 border-t pt-3">
          <p>Finalized obligations · accounting revision <span className="break-all font-mono text-xs">{postfinal.revision}</span>. Paid {money(postfinal.paidPlayerVnd)} · unpaid {money(postfinal.unpaidObligationVnd)} · unallocated {money(postfinal.unallocatedPoolVnd)}.</p>
          <p>Corrections append records; they do not edit the original snapshot or execute a payment.</p>
          <Label htmlFor={`kind-${eventId}`}>Correction type</Label>
          <select id={`kind-${eventId}`} className="w-full rounded border bg-background p-2" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="OBLIGATION_DELTA">Obligation delta</option><option value="PAYMENT_REVERSAL">Reverse a historical paid marker</option>
          </select>
          <Label htmlFor={`person-${eventId}`}>Original obligation</Label>
          <select id={`person-${eventId}`} className="w-full rounded border bg-background p-2" value={participationId} onChange={(e) => setParticipationId(e.target.value)}>
            <option value="">Select player</option>{payout?.obligations.map((row) => <option key={row.participationId} value={row.participationId}>{row.playerId.slice(0, 8)} · {money(row.totalVnd)}</option>)}
          </select>
          {kind === "PAYMENT_REVERSAL" && <><Label htmlFor={`payment-${eventId}`}>Original paid record</Label>
            <select id={`payment-${eventId}`} className="w-full rounded border bg-background p-2" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">Select paid record</option>{payout?.sourceSnapshot?.payments?.map((row) => <option key={row.id} value={row.id}>{row.playerId.slice(0, 8)} · {money(row.amountVnd)}</option>)}
            </select></>}
          <Label htmlFor={`delta-${eventId}`}>Signed delta (VND; reversal is negative)</Label><Input id={`delta-${eventId}`} type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <Label htmlFor={`reason-${eventId}`}>Reason</Label><Input id={`reason-${eventId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Label htmlFor={`evidence-${eventId}`}>Evidence reference</Label><Input id={`evidence-${eventId}`} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          <Button type="button" disabled={busy || !participationId || !Number.isSafeInteger(Number(delta)) || Number(delta) === 0 || reason.trim().length < 8 || evidence.trim().length < 8 || (kind === "PAYMENT_REVERSAL" && (!paymentId || Number(delta) >= 0))}
            onClick={() => void act(() => rpc("multi_day_request_payout_correction_v1", { p_event_id: eventId, p_kind: kind, p_participation_id: participationId, p_original_payment_id: kind === "PAYMENT_REVERSAL" ? paymentId : null, p_delta_vnd: Number(delta), p_expected_revision: postfinal.revision, p_reason: reason, p_evidence_ref: evidence, p_request_id: requestId(correctionKey) }), "Correction requested. Owner approval is still required.", correctionKey)}>Request correction</Button>
          {read.correctionRequests.map((request) => <div key={request.requestId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
            <span>{request.kind} · {money(request.deltaVnd)} · {request.state} · {request.reason}</span>
            {request.state === "PENDING_APPROVAL" && <Button type="button" size="sm" variant="outline" disabled={busy || !read.releaseEnabled}
              onClick={() => void act(() => rpc("multi_day_approve_payout_correction_v1", { p_request_id: request.requestId, p_approval_request_id: requestId(`approve:${request.requestId}`) }), "Correction approved and reconciled; no payment executed.", `approve:${request.requestId}`)}>Approve</Button>}
          </div>)}
        </div>}
      </div>}
    </>}
  </section>;
}
