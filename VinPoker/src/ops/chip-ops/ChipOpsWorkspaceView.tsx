import { CircleAlert, Coins, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  ChipOpsTournamentOption,
  IssuedChipInventory,
} from "@/ops/chip-ops/chipOpsReadAdapter";

export function ChipOpsWorkspaceView({
  clubName,
  tournaments,
  selectedTournamentId,
  inventory,
  loading,
  errorCode,
  onSelectTournament,
  onRefresh,
}: {
  clubName: string;
  tournaments: ChipOpsTournamentOption[];
  selectedTournamentId: string;
  inventory: IssuedChipInventory | null;
  loading: boolean;
  errorCode: string | null;
  onSelectTournament: (tournamentId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#d8bc85]">
            <Coins className="h-4 w-4" /> Chip vault read surface
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Chip Ops</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · chỉ xem chip đã phát hành</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ_ONLY</span>
          <button
            type="button"
            data-ops-action="chip-ops.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Làm mới Chip Ops"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Chỉ gọi RPC cố định <code>get_issued_chip_inventory</code>. Setup stack, Color-Up, Bag &amp; Tag và Két/Audit không được mount.
      </div>

      <label className="block max-w-xl text-sm text-[#b9c8c0]">
        Giải đấu
        <select
          value={selectedTournamentId}
          onChange={(event) => onSelectTournament(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-[#07100c] px-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <option value="">Chọn giải trong CLB</option>
          {tournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>{tournament.name} · {tournament.status}</option>
          ))}
        </select>
      </label>

      {errorCode ? (
        <StateCard title="Không tải được tồn chip" detail={errorCode} />
      ) : loading ? (
        <StateCard title="Đang tải snapshot chip…" />
      ) : !selectedTournamentId ? (
        <StateCard title="Chọn một giải để xem chip đã phát hành." />
      ) : !inventory ? (
        <StateCard title="Chưa có snapshot tồn chip." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric label="Giá trị đã phát hành" value={formatNumber(inventory.totalValue)} />
            <Metric label="Giá trị đối soát" value={formatNumber(inventory.reconciliationValue)} />
            <div className={`rounded-2xl border px-4 py-3 ${inventory.reconciled ? "border-emerald-300/20 bg-emerald-300/8" : "border-amber-300/20 bg-amber-300/8"}`}>
              <span className="text-[11px] text-[#91a49b]">Đối soát</span>
              <span className={`mt-1 block font-semibold ${inventory.reconciled ? "text-emerald-200" : "text-amber-200"}`}>
                {inventory.reconciled ? "KHỚP" : "CHÊNH LỆCH"}
              </span>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#07100c]">
            {inventory.denominations.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#91a49b]">Chưa có mệnh giá đã phát hành.</p>
            ) : inventory.denominations.map((denomination) => (
              <div key={denomination.denominationId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/7 px-4 py-4 last:border-b-0 sm:px-5">
                <div className="min-w-0">
                  <span className="block truncate font-mono font-semibold text-white">{formatNumber(denomination.value)}</span>
                  <span className="mt-1 block truncate text-xs text-[#91a49b]">{denomination.color ?? "Không ghi màu"}</span>
                </div>
                <span className="font-mono text-sm text-[#d8bc85]">{formatNumber(denomination.issuedCount)} chip</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[#07100c] px-4 py-3">
      <span className="text-[11px] text-[#91a49b]">{label}</span>
      <span className="mt-1 block truncate font-mono text-lg font-semibold text-white">{value}</span>
    </div>
  );
}

function StateCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <CircleAlert className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs text-rose-200">{detail}</p>}
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN");
}
