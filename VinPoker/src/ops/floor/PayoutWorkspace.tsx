import { CircleCheck, Clock3, ShieldCheck, Trophy } from "lucide-react";
import { useMemo } from "react";
import { useTournamentOps } from "@/ops/floor/TournamentOpsProvider";

const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);

export default function PayoutWorkspace() {
  const { entries, prizes, errors } = useTournamentOps();
  const entryByPlace = useMemo(
    () => new Map(
      entries
        .filter((entry) => entry.finishedPlace != null)
        .map((entry) => [entry.finishedPlace as number, entry]),
    ),
    [entries],
  );

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Không gian giải</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Trả thưởng</h2>
        <p className="mt-1 text-sm text-[#91a49b]">
          Floor chỉ xem cơ cấu và kết quả hiện có. Không có nút ghi nhận trả tiền trong workspace này.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-50">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div>
          <p className="font-semibold">Chế độ chỉ đọc</p>
          <p className="mt-1 text-emerald-100/70">
            Mọi money-path vẫn thuộc Owner/Cashier và các flag hiện hữu. PR này không tạo request và không gọi direct payment RPC.
          </p>
        </div>
      </div>

      {errors.payout ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-200">
          {errors.payout}
        </div>
      ) : prizes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <Trophy className="mx-auto h-8 w-8 text-[#789084]" />
          <p className="mt-3 text-sm text-[#91a49b]">Chưa có cơ cấu giải thưởng.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10">
          {prizes.map((prize) => {
            const entry = entryByPlace.get(prize.position);
            return (
              <div
                key={prize.id}
                className="grid min-h-20 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/8 bg-white/[0.025] px-4 last:border-0"
              >
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300/10 font-mono font-semibold text-amber-200">
                  #{prize.position}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{entry?.playerName ?? "Chưa chốt người nhận"}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[#91a49b]">
                    {entry ? <CircleCheck className="h-3.5 w-3.5 text-emerald-300" /> : <Clock3 className="h-3.5 w-3.5" />}
                    {entry ? `Entry ${entry.entryNumber} · kết quả server` : "Chờ kết quả hạng"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold text-emerald-200">{money(prize.amount)}</p>
                  <p className="mt-1 text-xs text-[#789084]">{prize.percentage}%</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
