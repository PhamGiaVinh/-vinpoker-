import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, Shuffle, Tv2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  createFloorTableControlV3Client,
  type FloorRedrawPlan,
  type FloorTournamentInventoryItem,
  type FloorTournamentTableRoster,
} from "@/lib/floorTableControlV3";

type RedrawClient = Pick<
  ReturnType<typeof createFloorTableControlV3Client>,
  | "getTournamentTableInventory"
  | "planTournamentRedraw"
  | "applyTournamentRedraw"
  | "getActiveTournamentRedraw"
  | "continueTournamentRedraw"
>;

export function FloorRedrawDialogV1({
  open,
  onOpenChange,
  tournamentId,
  tables,
  client,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  tables: readonly FloorTournamentTableRoster[];
  client: RedrawClient;
  onApplied: () => void | Promise<void>;
}) {
  const [capacity, setCapacity] = useState<8 | 9>(9);
  const [inventory, setInventory] = useState<FloorTournamentInventoryItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<"setup" | "preview" | "done">("setup");
  const [plan, setPlan] = useState<FloorRedrawPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const [continueRequestId, setContinueRequestId] = useState<string | null>(null);
  const [continueRevision, setContinueRevision] = useState<number | null>(null);
  const playerCount = useMemo(() => tables.reduce((sum, table) => sum + table.seats.length, 0), [tables]);
  const requiredTableCount = Math.max(1, Math.ceil(playerCount / capacity));
  const selectable = useMemo(
    () => inventory.filter((item) => item.tableNumber != null && (item.availabilityStatus === "available" || item.availabilityStatus === "current_tournament")),
    [inventory],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCapacity(9);
    setPhase("setup");
    setPlan(null);
    setError(null);
    setContinued(false);
    setContinueRequestId(null);
    setContinueRevision(null);
    setBusy(true);
    void client.getTournamentTableInventory(tournamentId).then((result) => {
      if (!active) return;
      if (result.ok === false) {
        setInventory([]);
        setSelectedIds([]);
        setError(redrawMessage(result.error));
      } else {
        setInventory(result.data);
        const current = result.data
          .filter((item) => item.availabilityStatus === "current_tournament")
          .sort((a, b) => (a.tableNumber ?? 101) - (b.tableNumber ?? 101))
          .map((item) => item.gameTableId);
        setSelectedIds(current.slice(0, Math.max(1, Math.ceil(playerCount / 9))));
      }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, open, playerCount, tournamentId]);

  useEffect(() => {
    if (!open || inventory.length === 0 || phase !== "setup") return;
    setSelectedIds((current) => {
      const valid = current.filter((id) => selectable.some((item) => item.gameTableId === id)).slice(0, requiredTableCount);
      const fill = selectable
        .filter((item) => !valid.includes(item.gameTableId))
        .sort((a, b) => {
          const aCurrent = a.availabilityStatus === "current_tournament" ? 0 : 1;
          const bCurrent = b.availabilityStatus === "current_tournament" ? 0 : 1;
          return aCurrent - bCurrent || (a.tableNumber ?? 101) - (b.tableNumber ?? 101);
        })
        .map((item) => item.gameTableId);
      return [...valid, ...fill].slice(0, requiredTableCount);
    });
  }, [inventory, open, phase, requiredTableCount, selectable]);

  const toggleTable = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : current.length < requiredTableCount
        ? [...current, id]
        : current);
  };

  const preview = async () => {
    if (selectedIds.length !== requiredTableCount) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.planTournamentRedraw({
        tournamentId,
        targetMaxSeats: capacity,
        gameTableIds: selectedIds,
        requestId: crypto.randomUUID(),
      });
      if (result.ok === false) {
        setError(redrawMessage(result.error));
        return;
      }
      setPlan(result.data);
      setPhase("preview");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.applyTournamentRedraw({ batchId: plan.batchId, requestId: crypto.randomUUID() });
      if (result.ok === false) {
        setError(redrawMessage(result.error));
        if (result.error === "STALE_REDRAW_PLAN") setPhase("setup");
        return;
      }
      setPlan(result.data);
      setPhase("done");
      await onApplied();
    } finally {
      setBusy(false);
    }
  };

  const continueRedraw = async () => {
    if (!plan || continued) return;
    setBusy(true);
    setError(null);
    try {
      let requestId = continueRequestId;
      let expectedRedrawRevision = continueRevision;
      if (!requestId || expectedRedrawRevision == null) {
        const active = await client.getActiveTournamentRedraw(tournamentId);
        if (active.ok === false) {
          setError(redrawMessage(active.error));
          return;
        }
        if (!active.data || active.data.batchId !== plan.batchId) {
          setError(redrawMessage("REDRAW_HOLD_NOT_ACTIVE"));
          return;
        }
        requestId = crypto.randomUUID();
        expectedRedrawRevision = active.data.redrawRevision;
        setContinueRequestId(requestId);
        setContinueRevision(expectedRedrawRevision);
      }
      const result = await client.continueTournamentRedraw({
        batchId: plan.batchId,
        expectedRedrawRevision,
        requestId,
      });
      if (result.ok === false) {
        setError(redrawMessage(result.error));
        return;
      }
      setContinued(true);
      setContinueRequestId(null);
      setContinueRevision(null);
      setError(result.data.clockResumed
        ? "Redraw finished. The tournament clock is running again."
        : "Redraw finished. The clock remains paused because it was already paused or changed during the display.");
      await onApplied();
    } catch {
      setError("Connection interrupted. Retry Continue; the same request will safely return its original receipt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-0 bg-[#0d0913] p-0 sm:h-[90vh] sm:w-[calc(100vw-2rem)] sm:max-w-4xl sm:rounded-3xl sm:border sm:border-white/10">
        <DialogHeader className="border-b border-white/8 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-xl text-[#f2ece6]"><Shuffle className="h-5 w-5 text-[#c9a86a]" /> Tournament redraw</DialogTitle>
          <DialogDescription className="text-sm text-[#9b8e97]">
            {phase === "setup" ? "Choose 8-max or 9-max and the required tables for this tournament." : phase === "preview" ? "This preview is fixed. Confirm to apply these exact seat movements." : "The redraw is on the TV. Continue when players have reached their new seats."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
          {error && <div role="alert" className="mb-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-200">{error}</div>}
          {phase === "setup" ? (
            <div className="space-y-5">
              <section>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b8e97]">Seats per table</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {([8, 9] as const).map((value) => (
                    <button key={value} type="button" data-ops-action="floor.redraw.select_capacity" onClick={() => setCapacity(value)} className={cn("min-h-14 rounded-2xl border px-3 text-left", capacity === value ? "border-[#c9a86a] bg-[#c9a86a]/14 text-[#f2ece6]" : "border-white/10 bg-white/[0.035] text-[#9b8e97]") }>
                      <span className="block text-lg font-bold">{value}-max</span>
                      <span className="text-xs">Seats 1–{value}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b8e97]">Destination tables</div>
                    <div className="mt-1 text-sm text-[#f2ece6]">{playerCount} players → {requiredTableCount} tables required</div>
                  </div>
                  <div className={cn("font-mono text-sm", selectedIds.length === requiredTableCount ? "text-emerald-300" : "text-amber-300")}>{selectedIds.length}/{requiredTableCount}</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {selectable.map((item) => {
                    const selected = selectedIds.includes(item.gameTableId);
                    return (
                      <button key={item.gameTableId} type="button" data-ops-action="floor.redraw.select_table" onClick={() => toggleTable(item.gameTableId)} className={cn("min-h-14 rounded-2xl border px-3 py-2 text-left", selected ? "border-emerald-400/60 bg-emerald-400/12" : "border-white/10 bg-white/[0.035]") }>
                        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[#f2ece6]">Table {item.tableNumber}{selected && <Check className="h-4 w-4 text-emerald-300" />}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#9b8e97]">{item.availabilityStatus === "current_tournament" ? `In this tournament · ${item.maxSeats}-max` : "Available"}</span>
                      </button>
                    );
                  })}
                </div>
                {selectable.length < requiredTableCount && <p className="mt-2 text-xs text-rose-300">Not enough club tables are available. Tables assigned to another tournament, Cash, or VIP are hidden.</p>}
              </section>
            </div>
          ) : (
            <section className="space-y-3">
              <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/8 px-3 py-3 text-sm text-[#f2ece6]">
                {plan?.moves.length ?? 0} players · {plan?.targetTableCount ?? requiredTableCount} tables · {plan?.targetMaxSeats ?? capacity}-max
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                {(plan?.moves ?? []).map((move) => (
                  <div key={move.entryId} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/8 px-3 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-sm font-semibold text-[#f2ece6]">{move.playerName}</span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-[#9b8e97]">
                      T{move.fromTableNumber}·S{move.fromSeatNumber}<ArrowRight className="h-3.5 w-3.5 text-[#c9a86a]" /><b className="text-emerald-300">T{move.toTableNumber}·S{move.toSeatNumber}</b>
                    </span>
                  </div>
                ))}
              </div>
              {phase === "done" && <div className="flex items-center gap-2 rounded-2xl border border-[#c9a86a]/30 bg-[#c9a86a]/10 px-3 py-3 text-sm text-[#f2ece6]"><Tv2 className="h-5 w-5 text-[#c9a86a]" /> TV is showing this saved redraw. It will not generate or apply another draw.</div>}
            </section>
          )}
        </div>

        <footer className="border-t border-white/8 bg-[#0d0913]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 sm:pb-4">
          {phase === "setup" ? (
              <Button data-ops-action="floor.redraw.preview" className="min-h-12 w-full" disabled={busy || selectedIds.length !== requiredTableCount || selectable.length < requiredTableCount} onClick={() => void preview()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />} Save preview
            </Button>
          ) : phase === "preview" ? (
            <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
              <Button variant="outline" className="min-h-12" disabled={busy} onClick={() => { setPlan(null); setPhase("setup"); }}>Edit</Button>
              <Button data-ops-action="floor.redraw.apply" className="min-h-12 bg-rose-600 hover:bg-rose-500" disabled={busy} onClick={() => void apply()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />} Confirm redraw
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_0.7fr]">
              <Button asChild variant="outline" className="min-h-12">
                <a data-ops-action="floor.redraw.open_tv" href={`/tv/${tournamentId}?scene=redraw`} target="_blank" rel="noreferrer">
                  <Tv2 className="mr-2 h-4 w-4" /> Open TV
                </a>
              </Button>
              <Button data-ops-action="floor.redraw.continue" className="min-h-12" disabled={busy || continued} onClick={() => void continueRedraw()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {continued ? "Continued" : "Continue"}
              </Button>
              <Button variant="outline" className="min-h-12" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function redrawMessage(code: string): string {
  switch (code) {
    case "target_table_not_available": return "A destination table was just taken. Reload and try again.";
    case "target_table_count_mismatch": return "The selected table count no longer matches the required count.";
    case "insufficient_unlocked_capacity": return "There are not enough unlocked seats.";
    case "locked_seat_outside_capacity": return "Unlock seat 9 before switching this table to 8-max.";
    case "table_has_active_hand": return "A table still has an active hand. Finish it before redrawing.";
    case "STALE_REDRAW_PLAN": return "The tables, players, or seats changed after preview. Review a new plan.";
    case "no_active_players": return "There are no seated players to redraw.";
    case "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED": return "Tournament redraw is not enabled in this environment.";
    case "REDRAW_HOLD_NOT_ACTIVE": return "This redraw is no longer active. Reload the tournament view.";
    case "STALE_REDRAW_REVISION": return "The redraw changed. Reload before continuing.";
    case "redraw_table_hold_active": return "A redraw is still on hold. Continue it from the Floor screen first.";
    case "actor_not_allowed": return "Your account is not authorized to continue this tournament.";
    default: return `Redraw failed (${code}).`;
  }
}
