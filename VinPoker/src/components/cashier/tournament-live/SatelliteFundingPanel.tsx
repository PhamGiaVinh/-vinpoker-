import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Funding = {
  ok: true; locked: boolean; canApprove?: boolean;
  sourcePoolVnd?: string; ticketLiabilityVnd?: string; cashLiabilityVnd?: string;
  sourceConfirmedGrossVnd?: string; sourceEntryFeesVnd?: string;
  overlayVnd?: string; remainingVnd?: string;
};
type TransferSummary = {
  issuedCount: number; redeemedCount: number;
  issuedValueVnd: string; transferredValueVnd: string; outstandingValueVnd: string;
  unissuedValueVnd: string;
};
const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>;
const amount = (value?: string) => value && /^\d{1,16}$/.test(value)
  ? `${Number(value).toLocaleString("en-US")} VND` : "—";

function parseFunding(raw: unknown): Funding {
  if (!raw || typeof raw !== "object") throw new Error("Invalid funding response");
  const value = raw as Funding;
  if (value.ok !== true || typeof value.locked !== "boolean") throw new Error("Invalid funding response");
  if (value.locked && [value.sourceConfirmedGrossVnd, value.sourceEntryFeesVnd,
    value.sourcePoolVnd, value.ticketLiabilityVnd,
    value.cashLiabilityVnd, value.overlayVnd, value.remainingVnd]
    .some(item => !/^\d{1,16}$/.test(item ?? ""))) throw new Error("Incomplete funding response");
  return value;
}

export function SatelliteFundingPanel({ sourceTournamentId, onLockedChange, onOwnerChange }: {
  sourceTournamentId: string; onLockedChange: (locked: boolean) => void;
  onOwnerChange: (canApprove: boolean) => void;
}) {
  const [funding, setFunding] = useState<Funding | null>(null);
  const [preview, setPreview] = useState<Funding | null>(null);
  const [transfer, setTransfer] = useState<TransferSummary | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferReload, setTransferReload] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    onLockedChange(false);
    onOwnerChange(false);
    setFunding(null);
    setTransfer(null);
    setTransferError(null);
    setPreview(null);
    setConfirmed(false);
    setError(null);
    const { data, error: rpcError } = await rpc("satellite_get_funding_v1", {
      p_source_tournament_id: sourceTournamentId,
    });
    try {
      if (rpcError) throw rpcError;
      const result = parseFunding(data);
      setFunding(result);
      onLockedChange(result.locked);
      onOwnerChange(result.canApprove === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read funding");
    }
  }, [onLockedChange, onOwnerChange, sourceTournamentId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!funding?.locked) return;
    let active = true;
    void rpc("satellite_get_transfer_summary_v1", {
      p_source_tournament_id: sourceTournamentId,
    }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) { setTransferError(rpcError.message); return; }
      const value = data as Partial<TransferSummary> | null;
      if (!value || !Number.isInteger(value.issuedCount) || !Number.isInteger(value.redeemedCount)
        || [value.issuedValueVnd, value.transferredValueVnd, value.outstandingValueVnd,
          value.unissuedValueVnd]
          .some(item => !/^\d{1,16}$/.test(item ?? ""))) {
        setTransferError("Ticket reconciliation is incomplete"); return;
      }
      setTransfer(value as TransferSummary);
      setTransferError(null);
    });
    return () => { active = false; };
  }, [funding?.locked, sourceTournamentId, transferReload]);

  const act = async (lock: boolean) => {
    if (busy || !funding?.canApprove || (lock && (!confirmed || !preview?.overlayVnd))) return;
    setBusy(true); setError(null);
    try {
      const { data, error: rpcError } = await rpc("satellite_approve_funding_v1", {
        p_source_tournament_id: sourceTournamentId,
        p_overlay_vnd: lock ? preview?.overlayVnd : null,
        p_lock: lock,
      });
      if (rpcError) throw rpcError;
      const result = parseFunding(data);
      if (result.locked !== lock || !result.sourcePoolVnd || !result.ticketLiabilityVnd
        || !result.sourceConfirmedGrossVnd || !result.sourceEntryFeesVnd
        || !result.cashLiabilityVnd || !result.overlayVnd || !result.remainingVnd) {
        throw new Error("Incomplete server reconciliation");
      }
      if (lock) {
        setFunding({ ...result, canApprove: funding.canApprove });
        setPreview(null);
        onLockedChange(true);
      } else {
        setPreview(result);
        setConfirmed(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reconcile funding");
      if (lock) void load(); // A lost response may still have committed.
    } finally { setBusy(false); }
  };

  return <section className="space-y-3 rounded-lg border border-amber-500/30 p-3" aria-label="Satellite funding">
    <div><h3 className="font-semibold">Source pool and ticket funding</h3>
      <p className="text-xs text-muted-foreground">Owner approval is required after the source tour closes. Ticket prices include buy-in and fees. No ticket can be issued before funding is locked.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!funding && <Button type="button" variant="outline" onClick={() => void load()}>Retry funding read</Button>}
    {funding?.locked && <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt>Confirmed Satellite collection</dt><dd>{amount(funding.sourceConfirmedGrossVnd)}</dd></div>
      <div><dt>Satellite entry fees</dt><dd>{amount(funding.sourceEntryFeesVnd)}</dd></div>
      <div><dt>Source prize pool</dt><dd>{amount(funding.sourcePoolVnd)}</dd></div>
      <div><dt>Ticket liability</dt><dd>{amount(funding.ticketLiabilityVnd)}</dd></div>
      <div><dt>Cash prizes owed</dt><dd>{amount(funding.cashLiabilityVnd)}</dd></div>
      <div><dt>Club overlay approved</dt><dd>{amount(funding.overlayVnd)}</dd></div>
      <div><dt>Remaining pool</dt><dd>{amount(funding.remainingVnd)}</dd></div>
    </dl>}
    {funding?.locked && <div className="rounded bg-muted/40 p-3 text-sm" aria-label="Ticket reconciliation">
      <div className="flex items-center justify-between gap-2"><h4 className="font-medium">Ticket reconciliation</h4>
        <Button type="button" variant="ghost" size="sm" onClick={() => setTransferReload(value => value + 1)}>Refresh</Button></div>
      {transferError && <p role="alert" className="text-destructive">{transferError}</p>}
      {!transfer && !transferError && <p>Loading ticket transfers…</p>}
      {transfer && <>
        <p>Issued: {transfer.issuedCount} tickets · {amount(transfer.issuedValueVnd)}</p>
        <p>Redeemed at target: {transfer.redeemedCount} · {amount(transfer.transferredValueVnd)}</p>
        <p>Outstanding ticket value: {amount(transfer.outstandingValueVnd)}</p>
        {transfer.unissuedValueVnd !== "0" && <p>Not yet issued: {amount(transfer.unissuedValueVnd)}</p>}
        <p className="text-xs text-muted-foreground">Collected at Satellite; redeemed tickets are internal transfers, not new target cash.</p>
      </>}
    </div>}
    {funding && !funding.locked && (funding.canApprove ? <>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void act(false)}>Preview source funding</Button>
      {preview && <div role="status" className="space-y-1 rounded bg-muted/40 p-3 text-sm">
        <p>Confirmed collection: {amount(preview.sourceConfirmedGrossVnd)}</p>
        <p>Satellite entry fees: {amount(preview.sourceEntryFeesVnd)}</p>
        <p>Source pool: {amount(preview.sourcePoolVnd)}</p><p>Ticket liability: {amount(preview.ticketLiabilityVnd)}</p>
        <p>Cash prizes: {amount(preview.cashLiabilityVnd)}</p><p>Club overlay required: {amount(preview.overlayVnd)}</p>
        <p>Remaining: {amount(preview.remainingVnd)}</p>
        <p className="text-xs">Confirmed collection = source pool + Satellite fees. Pool + overlay = tickets + cash prizes + remaining.</p>
      </div>}
      {preview && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I approve this exact source funding and club overlay.</label>}
      <Button type="button" disabled={busy || !preview || !confirmed} onClick={() => void act(true)}>Lock funding</Button>
    </> : <p className="text-sm text-amber-400">Waiting for the club owner to approve source funding.</p>)}
  </section>;
}
