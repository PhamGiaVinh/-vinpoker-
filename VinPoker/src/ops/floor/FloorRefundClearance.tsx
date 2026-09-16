import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { assertMutationOk, OPS_CASHIER_MUTATIONS_ENABLED } from "@/ops/opsMutations";
import { useTournamentOps } from "@/ops/workspace/TournamentOpsProvider";

type RefundRow = {
  id: string; registration_id: string; player_name: string; reference_code: string;
  amount: number; reason: string; status: "requested" | "floor_cleared";
};

export default function FloorRefundClearance() {
  const client = useSupabaseClient();
  const { snapshot } = useTournamentOps();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error: rpcError } = await client.rpc("cashier_floor_refunds_v1" as never, {
        p_tournament_id: snapshot.tournamentId,
      } as never);
      if (!active) return;
      if (rpcError) { setError(rpcError.message); return; }
      const result = data as unknown as { ok: boolean; rows?: RefundRow[]; error?: string };
      if (!result?.ok) { setError(result?.error ?? "Không tải được yêu cầu hoàn tiền."); return; }
      setRows(result.rows ?? []); setError(null);
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client, snapshot.tournamentId, revision]);

  if (!OPS_CASHIER_MUTATIONS_ENABLED) return null;
  return <section className="mt-5 rounded-2xl border border-amber-300/20 bg-[#101810] p-4">
    <h2 className="text-lg font-semibold text-white">Yêu cầu hoàn buy-in · Floor</h2>
    <p className="mt-1 text-xs text-[#a9baae]">Xử lý chip và kết thúc lượt bằng công cụ Floor trước. Nút này chỉ xác nhận điều kiện; thu ngân chi tiền ở quầy.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
    {!rows.length ? <p className="mt-3 text-sm text-[#a9baae]">Không có yêu cầu đang chờ.</p> :
      <div className="mt-3 space-y-2">{rows.map((row) => <article key={row.id} className="rounded-xl border border-white/10 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.player_name}</strong>
          <span>{new Intl.NumberFormat("vi-VN").format(row.amount)} VND</span></div>
        <p className="mt-1 break-all font-mono text-xs text-[#a9baae]">{row.reference_code}</p>
        <p className="mt-2 text-[#cbd6cc]">{row.reason}</p>
        {row.status === "requested" ? <button type="button" disabled={busyId !== null}
          onClick={async () => {
            if (!window.confirm(`Floor đã xử lý chip và kết thúc lượt của ${row.player_name}?`)) return;
            setBusyId(row.id); setError(null);
            try {
              const { data, error: rpcError } = await client.rpc("cashier_floor_clear_refund_v1" as never, {
                p_refund_id: row.id,
              } as never);
              assertMutationOk(data,rpcError);
              setRevision((value) => value+1);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Floor chưa xác nhận được điều kiện hoàn.");
            } finally { setBusyId(null); }
          }} className="mt-3 min-h-11 rounded-lg border border-amber-300/40 px-4 font-semibold text-amber-200 disabled:opacity-40">
          Đã xử lý chip/lượt · xác nhận cho thu ngân</button>
          : <p className="mt-3 text-emerald-200">Đã thông qua · chờ thu ngân ghi nhận chi hoàn</p>}
      </article>)}</div>}
  </section>;
}
