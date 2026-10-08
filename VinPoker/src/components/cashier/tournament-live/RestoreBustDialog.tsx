import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc, type FloorTournamentTableRoster } from "@/lib/floorTableControlV3";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatStack } from "@/lib/format";

type RestoreIntent = Parameters<ReturnType<typeof createFloorTableControlV3Client>["restoreBustedPlayer"]>[0];
const messages: Record<string, string> = {
  restore_result_dependency: "Giải đã có kết quả chốt hoặc payout. Không thể hoàn tác bust.",
  restore_reentry_dependency: "Người chơi đã có entry mới. Hoàn tác bust và re-entry là hai nghiệp vụ riêng.",
  restore_stack_evidence_missing: "Không có chứng cứ stack trước bust. Không tự cấp chip mới.",
  seat_locked: "Ghế đang khóa. Hãy chọn ghế khác.",
  seat_occupied: "Ghế đã có người. Hãy tải lại danh sách bàn.",
  table_has_active_hand: "Bàn đang chơi hand. Hãy chờ hand kết thúc.",
  STALE_STATE: "Phiên bàn đã thay đổi. Đóng cửa sổ và tải lại trước khi chọn ghế.",
  table_session_mismatch: "Phiên bàn đã đóng hoặc bị thay thế. Không chuyển yêu cầu cũ sang phiên mới.",
  exact_session_required: "Cần tải lại phiên bàn trước khi khôi phục.",
  actor_not_allowed: "Tài khoản không có quyền hoàn tác bust ở CLB này.",
};

export function RestoreBustDialog({ tournamentId, target, onClose, onRestored, actorId }: {
  tournamentId: string;
  target: { entryId: string; name: string; destination?: { tableId: string; seatNumber: number } } | null;
  onClose: () => void;
  onRestored: () => void;
  actorId: string | null;
}) {
  const supabase = useSupabaseClient();
  const client = useMemo(() => createFloorTableControlV3Client(
    ((name, args) => (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args)),
  ), [supabase]);
  const attempts = useRef(new Map<string, RestoreIntent>());
  const scope = `${actorId ?? ""}:${tournamentId}:${target?.entryId ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [tables, setTables] = useState<FloorTournamentTableRoster[]>([]);
  const [stack, setStack] = useState<number | null>(null);
  const [tableId, setTableId] = useState("");
  const [seat, setSeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedScope, setVerifiedScope] = useState("");
  const [unresolved, setUnresolved] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let disposed = false;
    setTables([]); setStack(null); setTableId(""); setSeat(""); setError(null); setVerifiedScope("");
    setUnresolved(attempts.current.has(scope));
    if (!target || !actorId) return;
    setLoading(true);
    void Promise.all([client.getTournamentTableRoster(tournamentId), client.getRestorableEntries(tournamentId)])
      .then(([roster, entries]) => {
        if (disposed) return;
        if (roster.ok === false || entries.ok === false) {
          setError("Không tải được bàn hoặc chứng cứ stack. Không thể xác nhận lúc này."); return;
        }
        setTables(roster.data);
        setVerifiedScope(scope);
        const prior = attempts.current.get(scope);
        if (prior) { setTableId(prior.toTournamentTableId); setSeat(String(prior.toSeatNumber)); }
        else if (target.destination) { setTableId(target.destination.tableId); setSeat(String(target.destination.seatNumber)); }
        const entry = entries.data.find((row) => row.entryId === target.entryId);
        if (!entry) setError(messages.restore_stack_evidence_missing);
        else setStack(entry.currentStack);
      }).catch(() => { if (!disposed) setError("Không kết nối được server. Hãy đóng và mở lại để thử."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [client, target, tournamentId, actorId]);
  const table = tables.find((row) => row.tournamentTableId === tableId);
  const emptySeats = table ? Array.from({ length: table.maxSeats }, (_, i) => i + 1)
    .filter((n) => !table.seats.some((s) => s.seatNumber === n) && !table.seatLocks.some((s) => s.seatNumber === n)) : [];
  async function restore() {
    const prior = attempts.current.get(scope);
    if (pending.current || !target || !actorId || (!prior && (verifiedScope !== scope || !table || stack === null || !emptySeats.includes(Number(seat))))) return;
    const capturedScope = scope;
    const key = scope;
    const intent = prior ?? {
      entryId: target.entryId, toTournamentTableId: table.tournamentTableId, toSeatNumber: Number(seat),
      expectedRevision: table.sessionRevision, expectedControlEpoch: table.controlEpoch, requestId: crypto.randomUUID(),
      expectedTableSessionId: table.tableSessionId,
    };
    attempts.current.set(key, intent); setUnresolved(true);
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await client.restoreBustedPlayer(intent);
      if (currentScope.current !== capturedScope) return;
      if (result.ok === false) {
        if (result.error in messages) { attempts.current.delete(key); setUnresolved(false); }
        setError(messages[result.error] ?? `Chưa xác nhận hoàn tác (${result.error}). Thử lại sẽ dùng cùng mã yêu cầu.`); return;
      }
      attempts.current.delete(key); setUnresolved(false); onRestored(); onClose();
    } catch {
      if (currentScope.current === capturedScope) setError("Chưa biết server đã hoàn tất hay chưa. Thử lại giữ nguyên mã yêu cầu; không tạo thao tác mới.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Hoàn tác bust nhầm</DialogTitle><DialogDescription>
        {target?.name} · Khôi phục entry cũ bằng stack có chứng cứ, không phải re-entry.
      </DialogDescription></DialogHeader>
      {loading ? <p role="status">Đang xác minh bàn và stack…</p> : <>
        {stack !== null && <p>Stack sẽ khôi phục: <strong>{formatStack(stack)} chip</strong></p>}
        <label className="grid gap-1">Bàn
          <select aria-label="Bàn khôi phục" className="h-12 rounded-md border bg-background px-3" value={tableId} disabled={busy || unresolved || stack === null}
            onChange={(event) => { setTableId(event.target.value); setSeat(""); }}>
            <option value="">Chọn bàn</option>{tables.map((row) => <option key={row.tournamentTableId} value={row.tournamentTableId}>{row.tableName}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Ghế trống, không khóa
          <select aria-label="Ghế khôi phục" className="h-12 rounded-md border bg-background px-3" value={seat} disabled={busy || unresolved || !table}
            onChange={(event) => setSeat(event.target.value)}>
            <option value="">Chọn ghế</option>{emptySeats.map((n) => <option key={n} value={n}>Ghế {n}</option>)}
          </select>
        </label>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button className="min-h-12" disabled={busy || (!unresolved && (loading || verifiedScope !== scope || stack === null || !table || !seat))} onClick={() => void restore()}>
        {busy ? "Đang xác nhận…" : unresolved ? "Kiểm tra lại yêu cầu đã gửi" : "Xác nhận hoàn tác bust"}
      </Button>
    </DialogContent>
  </Dialog>;
}
