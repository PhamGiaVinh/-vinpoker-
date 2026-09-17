import { useEffect, useRef, useState } from "react";
import { TicketCheck } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { OPS_CASHIER_MUTATIONS_ENABLED } from "@/ops/opsMutations";

type Ticket = {
  ok: true; serial: number; status: string; targetTournamentId: string;
  targetTournamentName: string; entryPriceVnd: string;
  buyInVnd: string; feesVnd: string;
};
type Bearer = { playerId: string; displayName: string; source: string };
type Seat = { receipt_code?: string; table_number?: number; seat_number?: number };
type Redemption = { ok: true; idempotent: boolean; serial: number; reentry?: boolean;
  playerName?: string; cashReceivedVnd?: string; seat?: Seat };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const money = (value: string) => /^\d{1,16}$/.test(value)
  ? `${Number(value).toLocaleString("en-US")} VND` : "—";

export function SatelliteTicketRedemption({ tournamentId, enabled, onRedeemed, onBusyChange }: {
  tournamentId: string; enabled: boolean; onRedeemed: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const client = useSupabaseClient();
  const lock = useRef(false);
  const [code, setCode] = useState("");
  const [checkedCode, setCheckedCode] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Bearer[]>([]);
  const [bearer, setBearer] = useState<Bearer | null>(null);
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Redemption | null>(null);

  useEffect(() => {
    setCode(""); setCheckedCode(null); setTicket(null); setQuery(""); setPlayers([]); setBearer(null);
    setNewName(""); setMode("new"); setConfirmed(false); setResult(null); setError(null);
  }, [tournamentId]);

  useEffect(() => {
    if (!enabled || mode !== "existing" || query.trim().length < 3) {
      setPlayers(current => current.length ? [] : current); return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data, error: rpcError } = await client.rpc("satellite_find_bearer_v1" as never, {
        p_target_tournament_id: tournamentId, p_query: query.trim(),
      } as never);
      if (!active) return;
      const value = data as { ok?: boolean; players?: Bearer[] } | null;
      if (rpcError || value?.ok !== true || !Array.isArray(value.players)) {
        setError(rpcError?.message ?? "Could not search players"); setPlayers([]);
      } else { setError(null); setPlayers(value.players); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, enabled, mode, query, tournamentId]);

  const lookup = async () => {
    if (lock.current || !isUuid(code.trim())) { setError("Scan a valid private ticket QR/code."); return; }
    const currentCode = code.trim();
    lock.current = true; setBusy(true); onBusyChange(true);
    setError(null); setTicket(null); setCheckedCode(null); setResult(null); setConfirmed(false);
    try {
      const { data, error: rpcError } = await client.rpc("satellite_lookup_ticket_v1" as never, {
        p_redemption_code: currentCode,
      } as never);
      if (rpcError) throw rpcError;
      const value = data as Ticket | null;
      if (value?.ok !== true || !Number.isInteger(value.serial) || !isUuid(value.targetTournamentId)
        || !/^\d{1,16}$/.test(value.entryPriceVnd)) throw new Error("Invalid server ticket response");
      if (value.targetTournamentId !== tournamentId) throw new Error("This ticket is for a different tournament. No ticket was used.");
      setTicket(value); setCheckedCode(currentCode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ticket lookup failed"); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };

  const redeem = async () => {
    if (lock.current || !enabled || !OPS_CASHIER_MUTATIONS_ENABLED || !confirmed
      || ticket?.status !== "issued" || ticket.targetTournamentId !== tournamentId
      || checkedCode !== code.trim()
      || (mode === "existing" && !bearer)
      || (mode === "new" && (newName.trim().length < 2 || newName.trim().length > 100))) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(null);
    try {
      const { data, error: rpcError } = await client.rpc("satellite_redeem_ticket_v1" as never, {
        p_redemption_code: checkedCode, p_target_tournament_id: tournamentId,
        p_player_id: mode === "existing" ? bearer?.playerId : null,
        p_player_name: mode === "new" ? newName.trim() : null,
      } as never);
      if (rpcError) throw rpcError;
      const value = data as Redemption | null;
      if (value?.ok !== true || !value.seat || !value.seat.receipt_code
        || !Number.isInteger(value.seat.table_number) || !Number.isInteger(value.seat.seat_number)) {
        throw new Error("Server did not confirm a seat. Verify ticket status before retrying.");
      }
      setResult(value);
      setTicket(current => current ? { ...current, status: "redeemed" } : current);
      setConfirmed(false);
      onRedeemed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Redemption failed. Verify ticket status before retrying."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };

  return <section className="space-y-4 rounded-2xl border border-amber-300/20 bg-[#101c17] p-4" aria-label="Satellite ticket redemption">
    <div className="flex items-start gap-3"><TicketCheck className="mt-1 h-5 w-5 text-amber-300" />
      <div><h2 className="text-lg font-bold">Redeem Satellite ticket</h2>
        <p className="text-xs text-[#a9baae]">One transaction: consume ticket, register bearer, assign seat. No cash is received at this counter.</p></div></div>
    {!enabled && <p className="text-sm text-amber-200">Ticket redemption is unavailable while this tour or Cashier writes are disabled.</p>}
    <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-sm">Private QR / ticket code
      <input value={code} disabled={busy} onChange={event => { setCode(event.target.value); setTicket(null); setCheckedCode(null); setResult(null); setConfirmed(false); }}
        className="mt-1 min-h-11 w-full rounded-lg border border-white/20 bg-[#08120d] px-3 font-mono text-sm" autoComplete="off" />
    </label><button type="button" disabled={busy || !enabled || !isUuid(code.trim())} onClick={() => void lookup()}
      className="min-h-11 self-end rounded-lg border border-amber-300/50 px-4 disabled:opacity-40">Check ticket</button></div>
    {error && <p role="alert" className="rounded-lg bg-rose-950/40 p-3 text-sm text-rose-100">{error}</p>}
    {ticket && <div className="space-y-1 rounded-lg border border-white/10 p-3 text-sm">
      <p className="font-semibold">Serial #{ticket.serial} · {ticket.status}</p>
      <p>Target: {ticket.targetTournamentName}</p><p>Entry: {money(ticket.entryPriceVnd)} (buy-in {money(ticket.buyInVnd)} + fees {money(ticket.feesVnd)})</p>
      {ticket.status !== "issued" && !result && <p className="text-amber-200">This ticket cannot be consumed again.</p>}
    </div>}
    {ticket?.status === "issued" && <div className="space-y-3 border-t border-white/10 pt-3">
      <p className="text-sm font-semibold">Who is holding the ticket?</p>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setMode("new"); setBearer(null); setConfirmed(false); }}
        className={`min-h-11 rounded-lg px-3 ${mode === "new" ? "bg-amber-300 text-black" : "border border-white/20"}`}>New bearer</button>
      <button type="button" disabled={busy} onClick={() => { setMode("existing"); setConfirmed(false); }}
        className={`min-h-11 rounded-lg px-3 ${mode === "existing" ? "bg-amber-300 text-black" : "border border-white/20"}`}>Existing player / re-entry</button></div>
      {mode === "new" ? <label className="block text-sm">Bearer name<input value={newName} disabled={busy}
        onChange={event => { setNewName(event.target.value); setConfirmed(false); }}
        className="mt-1 min-h-11 w-full rounded-lg border border-white/20 bg-[#08120d] px-3" maxLength={100} /></label>
        : <div className="space-y-2"><label className="block text-sm">Search member or target entry
          <input value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setBearer(null); setConfirmed(false); }}
            className="mt-1 min-h-11 w-full rounded-lg border border-white/20 bg-[#08120d] px-3" /></label>
          {players.map(player => <button type="button" disabled={busy} key={player.playerId} onClick={() => { setBearer(player); setConfirmed(false); }}
            className={`block min-h-11 w-full rounded-lg border p-2 text-left text-sm ${bearer?.playerId === player.playerId ? "border-amber-300" : "border-white/20"}`}>
            {player.displayName} · {player.source === "target_entry" ? "target entry" : "member"}</button>)}
          {bearer && <p className="text-sm text-amber-200">Selected: {bearer.displayName}. Server will allow re-entry only if the prior entry is busted and registration is open.</p>}
        </div>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={event => setConfirmed(event.target.checked)} />I verified the target, ticket and bearer. Redeem and assign a seat now.</label>
      <button type="button" disabled={busy || !enabled || !confirmed || checkedCode !== code.trim()
        || ticket.targetTournamentId !== tournamentId || (mode === "existing" ? !bearer : newName.trim().length < 2)}
        onClick={() => void redeem()} className="min-h-11 rounded-lg bg-amber-300 px-4 font-bold text-black disabled:opacity-40">Redeem + register + seat</button>
    </div>}
    {result && <div role="status" className="rounded-lg border border-emerald-300/40 bg-emerald-950/30 p-3 text-sm">
      <p className="font-bold">{result.idempotent ? "Already redeemed for this bearer" : "Ticket redeemed and seat assigned"}</p>
      <p>{result.playerName ?? "Bearer"}{result.reentry ? " · re-entry" : ""} · Table {result.seat?.table_number}, seat {result.seat?.seat_number}</p>
      <p>Receipt: {result.seat?.receipt_code} · Cash received here: 0 VND</p>
    </div>}
  </section>;
}
