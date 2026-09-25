import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { parseMultiDayBaggingState, type BagRow, type BagState } from "./multiDayBaggingState";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
type Draft = { code: string; total: string };

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("multi_day_package_release_off")) return "Multi-day mutations are not enabled for this club.";
  if (message.includes("multi_day_bag_stale_or_sealed") || message.includes("multi_day_close_stale_day")) return "This record changed. Refresh before trying again.";
  if (message.includes("multi_day_bag_variance_unresolved") || message.includes("multi_day_day_close_bags_unreconciled")) return "All sealed bag totals must match the frozen Tracker stacks before closing.";
  if (message.includes("multi_day_bag_actor_not_allowed") || message.includes("multi_day_bag_seal_actor_not_allowed")) return "Your assigned role cannot perform this action.";
  if (message.includes("multi_day_bagging_not_open")) return "End Flight has not opened bagging for this flight.";
  return "The server could not complete this bagging action. Refresh and verify its status.";
}

export function MultiDayBaggingPanel({ tournamentId }: { tournamentId: string }) {
  const client = useSupabaseClient() as unknown as RpcClient;
  const [state, setState] = useState<BagState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRequests = useRef<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.rpc("multi_day_bagging_state_v1", { p_flight_tournament_id: tournamentId });
      if (result.error) throw new Error(result.error.message);
      const next = parseMultiDayBaggingState(result.data);
      setState(next);
      setDrafts(Object.fromEntries(next.rows.map((row) => [row.playerId,
        { code: row.bagCode ?? "", total: row.bagTotal === null ? "" : String(row.bagTotal) }])));
      setError(null);
    } catch (cause) { setState(null); setError(friendlyError(cause)); }
    finally { setLoading(false); }
  }, [client, tournamentId]);
  useEffect(() => { void reload(); }, [reload]);

  const mutate = async (name: string, args: Record<string, unknown>, success: string) => {
    const requestKey = `${name}:${JSON.stringify(args)}`;
    const requestId = pendingRequests.current[requestKey] ?? crypto.randomUUID();
    pendingRequests.current[requestKey] = requestId;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await client.rpc(name, { ...args, p_request_id: requestId });
      if (result.error) throw new Error(result.error.message);
      if (!result.data || typeof result.data !== "object" || (result.data as { ok?: unknown }).ok !== true) {
        throw new Error("Invalid bagging receipt");
      }
      setNotice(success);
      delete pendingRequests.current[requestKey];
      await reload();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  const save = (row: BagRow) => {
    const draft = drafts[row.playerId];
    const total = Number(draft?.total);
    if (!draft?.code.trim() || !draft.total.trim() || !Number.isSafeInteger(total) || total < 0) {
      setError("Enter a bag code and a non-negative whole-chip total."); return;
    }
    void mutate("multi_day_record_bag_v1", {
      p_flight_tournament_id: tournamentId, p_player_id: row.playerId,
      p_bag_code: draft.code.trim(), p_total_value: total,
      p_expected_revision: row.bagRevision,
    }, "Bag total recorded. A Chip Master must seal it.");
  };
  const seal = (row: BagRow) => void mutate("multi_day_seal_bag_v1", {
    p_flight_tournament_id: tournamentId,p_player_id: row.playerId,
    p_expected_revision: row.bagRevision,
  }, "Bag sealed at a pinned version.");
  const close = () => state && void mutate("multi_day_close_bagging_v1", {
    p_flight_tournament_id: tournamentId,p_expected_day_version: state.dayVersion,
  }, "Flight bagging locked.");

  return <section className="rounded-3xl border border-amber-300/20 bg-[#07100c] p-4 text-white sm:p-5" aria-label="Flight bagging">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Flight bagging</h2>
        <p className="mt-1 text-xs text-[#91a49b]">Frozen Tracker stack versus physical bag total. Bag totals do not create denomination inventory.</p></div>
      <button type="button" onClick={() => void reload()} disabled={busy || loading}
        className="min-h-11 rounded-xl border border-white/15 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50">Refresh</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">{notice}</p>}
    {loading ? <p className="mt-5 text-sm text-[#91a49b]">Loading frozen flight roster…</p>
      : !state ? <p className="mt-5 text-sm text-[#91a49b]">No verified End Flight snapshot is available.</p>
      : <>
        <p className="mt-4 text-sm text-[#d8bc85]">Day {state.dayNumber} · {state.status === "locked" ? "Locked" : "Bagging open"} · {state.rows.length} assigned {state.rows.length === 1 ? "player" : "players"}</p>
        <div className="mt-3 space-y-2">
          {state.rows.map((row) => {
            const draft = drafts[row.playerId] ?? { code: "", total: "" };
            return <div key={row.playerId} className="grid gap-3 rounded-2xl border border-white/10 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem_auto] sm:items-end">
              <div><p className="font-medium">Player {row.playerId.slice(0, 8)} · Seat {row.seatNumber}</p>
                <p className="text-xs text-[#91a49b]">Tracker stack: {row.trackedStack.toLocaleString("en-US")}</p></div>
              <label className="text-xs text-[#91a49b]">Bag code<input aria-label={`Bag code for ${row.playerId}`} value={draft.code} disabled={busy || row.sealed || state.status === "locked"}
                onChange={(event) => setDrafts((current) => ({ ...current, [row.playerId]: { ...draft, code: event.target.value } }))}
                className="mt-1 min-h-10 w-full rounded-lg border border-white/15 bg-[#0b1a13] px-2 text-white" /></label>
              <label className="text-xs text-[#91a49b]">Bag total<input aria-label={`Bag total for ${row.playerId}`} type="number" min={0} step={1} value={draft.total} disabled={busy || row.sealed || state.status === "locked"}
                onChange={(event) => setDrafts((current) => ({ ...current, [row.playerId]: { ...draft, total: event.target.value } }))}
                className="mt-1 min-h-10 w-full rounded-lg border border-white/15 bg-[#0b1a13] px-2 text-white" /></label>
              <p className="text-xs text-[#d8bc85]">{row.sealed ? `Sealed v${row.sealedVersion}` : `Draft v${row.bagRevision}`}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => save(row)} disabled={busy || row.sealed || state.status === "locked"}
                  className="min-h-10 rounded-lg border border-white/15 px-3 text-sm disabled:opacity-40">Save</button>
                {state.manager && <button type="button" onClick={() => seal(row)} disabled={busy || row.sealed || row.bagRevision<1 || row.bagTotal !== row.trackedStack || state.status === "locked"}
                  className="min-h-10 rounded-lg bg-[#d8bc85] px-3 text-sm font-semibold text-[#07100c] disabled:opacity-40">Seal</button>}
              </div>
            </div>;
          })}
        </div>
        {state.manager && state.status === "bagging" && <div className="mt-4 flex justify-end"><button type="button" onClick={close}
          disabled={busy || state.rows.length === 0 || state.rows.some((row) => !row.sealed)}
          className="min-h-11 rounded-xl bg-emerald-300 px-4 text-sm font-semibold text-[#07100c] disabled:opacity-40">Lock flight bagging</button></div>}
      </>}
  </section>;
}
