import { CircleAlert, Coins, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  ChipOpsTournamentOption,
  IssuedChipInventory,
  IssuedStackSummary,
} from "@/ops/chip-ops/chipOpsReadAdapter";

export function ChipOpsWorkspaceView({
  clubName,
  tournaments,
  selectedTournamentId,
  inventory,
  stacks,
  loading,
  errorCode,
  onSelectTournament,
  onRefresh,
}: {
  clubName: string;
  tournaments: ChipOpsTournamentOption[];
  selectedTournamentId: string;
  inventory: IssuedChipInventory | null;
  stacks: IssuedStackSummary | null;
  loading: boolean;
  errorCode: string | null;
  onSelectTournament: (tournamentId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#d8bc85]">
            <Coins className="h-4 w-4" /> Chip inventory
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Chip Ops</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · issued chips only</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ ONLY</span>
          <button
            type="button"
            data-ops-action="chip-ops.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Refresh Chip Ops"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Read-only snapshot from <code>get_issued_chip_inventory</code>. Stack setup, color-up, bag &amp; tag, and vault adjustments are not available here.
      </div>

      <label className="block max-w-xl text-sm text-[#b9c8c0]">
        Tournament
        <select
          value={selectedTournamentId}
          onChange={(event) => onSelectTournament(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-[#07100c] px-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <option value="">Select a tournament</option>
          {tournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>{tournament.name} · {tournament.status}</option>
          ))}
        </select>
      </label>

      {errorCode ? (
        <StateCard title="Unable to load chip inventory" detail={errorCode} />
      ) : loading ? (
        <StateCard title="Loading chip snapshot…" />
      ) : !selectedTournamentId ? (
        <StateCard title="Select a tournament to view issued chips." />
      ) : !inventory ? (
        <StateCard title="No chip snapshot available." />
      ) : (
        <>
          <section aria-label="Issued chip summary" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Stack sets issued" value={formatNumber(stacks?.totalIssuedStacks ?? 0)} />
            <Metric label="Issued chips" value={formatNumber(inventory.totalIssuedChips)} />
            <Metric
              label="Issued chip face value"
              value={formatNumber(inventory.totalValue)}
              detail="Chip value only · not cash or a prize pool"
            />
            <Metric label="Issued mix reconciliation" value={formatNumber(inventory.reconciliationValue)} />
          </section>

          <div className={`rounded-2xl border px-4 py-3 ${inventory.reconciled ? "border-emerald-300/20 bg-emerald-300/8" : "border-amber-300/20 bg-amber-300/8"}`}>
            <span className="text-[11px] text-[#91a49b]">Issued mix reconciliation</span>
            <span className={`mt-1 block font-semibold ${inventory.reconciled ? "text-emerald-200" : "text-amber-200"}`}>
              {inventory.reconciled ? "MATCHED" : "DISCREPANCY"}
            </span>
          </div>

          {stacks && stacks.templates.length > 0 && (
            <section aria-labelledby="chip-stack-heading" className="overflow-hidden rounded-3xl border border-white/8 bg-[#07100c]">
              <h2 id="chip-stack-heading" className="px-5 py-3 text-sm font-semibold text-white">Issued stack sets</h2>
              {stacks.templates.map((stack) => (
                <div key={stack.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-white/7 px-5 py-3 text-sm">
                  <span className="truncate text-[#b9c8c0]">{stack.name} · {formatNumber(stack.stackValue)} face value per set</span>
                  <span className="font-mono text-[#d8bc85]">{formatNumber(stack.issuedCount)} sets</span>
                </div>
              ))}
            </section>
          )}

          <section aria-labelledby="chip-denomination-heading" className="space-y-3">
            <div>
              <h2 id="chip-denomination-heading" className="text-lg font-semibold text-white">Issued chips by denomination</h2>
              <p className="mt-1 text-sm leading-6 text-[#91a49b]">
                Physical stock not recorded. This snapshot reports issued counts only; it does not include vault totals or available counts.
              </p>
            </div>
            {inventory.denominations.length === 0 ? (
              <div role="status" className="rounded-2xl border border-white/8 bg-[#07100c] px-5 py-8 text-center text-sm text-[#91a49b]">
                No issued denomination rows in this snapshot. Physical stock not recorded.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {inventory.denominations.map((denomination) => (
                  <article key={denomination.denominationId} className="rounded-2xl border border-white/8 bg-[#07100c] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-mono text-lg font-semibold text-white">{formatNumber(denomination.value)}</h3>
                        <p className="mt-1 truncate text-xs text-[#91a49b]">{denomination.color ?? "Color not recorded"}</p>
                      </div>
                      <Coins aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#d8bc85]" />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-3">
                      <div>
                        <dt className="text-xs text-[#91a49b]">Issued chips</dt>
                        <dd className="mt-1 font-mono text-base font-semibold text-[#d8bc85]">{formatNumber(denomination.issuedCount)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#91a49b]">Physical stock</dt>
                        <dd className="mt-1 text-sm font-medium text-amber-200">Not recorded</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[#07100c] px-4 py-3">
      <span className="text-[11px] text-[#91a49b]">{label}</span>
      <span className="mt-1 block truncate font-mono text-lg font-semibold text-white">{value}</span>
      {detail && <span className="mt-1 block text-xs leading-5 text-[#91a49b]">{detail}</span>}
    </div>
  );
}

function StateCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role={detail ? "alert" : "status"} className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <CircleAlert aria-hidden="true" className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs text-rose-200">{detail}</p>}
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
