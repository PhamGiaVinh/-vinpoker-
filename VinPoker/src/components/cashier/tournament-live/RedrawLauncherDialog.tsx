import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shuffle, Loader2, AlertTriangle, CheckCircle2, Eye } from "lucide-react";

type Mode = "final_table" | "table_count_threshold" | "itm" | "manual_custom";
type DrawMode = "redraw_balanced" | "fill_lowest_table";

interface Move {
  player_name: string;
  from_table_number: number | null;
  from_seat: number;
  to_table_number: number | null;
  to_seat_number: number;
}
interface RedrawResult {
  ok?: boolean; error?: string; need?: number; have?: number; note?: string;
  eligible?: number; target_table_count?: number; moved_count?: number;
  moves?: Move[]; tables_to_close?: { table_number: number }[]; tables_closed?: { table_number: number }[];
}
interface SeatedPlayer { entry_id: string; player_name: string; table_number: number | null; seat_number: number; }

const MODE_LABELS: Record<Mode, string> = {
  final_table: "Final table (gộp về 1 bàn)",
  table_count_threshold: "Theo mốc số bàn (gộp còn N bàn)",
  itm: "ITM — vào tiền (bốc lại người còn lại)",
  manual_custom: "Chọn người thủ công",
};

function mapError(res: RedrawResult | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền bốc lại cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "invalid_mode": return "Chế độ không hợp lệ (Day 2 chưa hỗ trợ).";
    case "manual_requires_entry_ids": return "Hãy chọn ít nhất 1 người chơi.";
    case "no_target_tables": return "Không có bàn đích hợp lệ.";
    case "insufficient_capacity":
      return `Không đủ ghế trống (cần ${res?.need ?? "?"}, có ${res?.have ?? "?"}) — mở thêm bàn / tăng số bàn đích.`;
    default: return code ? `Bốc lại thất bại (${code})` : "Bốc lại thất bại";
  }
}

/**
 * "Bốc lại / Redraw" launcher (Phase A2). Room-level scheduled/tournament redraw via the
 * live `redraw_tournament` RPC. Two-step: PREVIEW (p_dry_run=true, no writes) then CONFIRM
 * (p_dry_run=false). Gated behind FEATURES.floorTableOps by the caller. Seat moves only — no money.
 */
export function RedrawLauncherDialog({
  open, onOpenChange, tournamentId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("final_table");
  const [drawMode, setDrawMode] = useState<DrawMode>("redraw_balanced");
  const [targetCount, setTargetCount] = useState<string>("");
  const [players, setPlayers] = useState<SeatedPlayer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"config" | "preview" | "done">("config");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RedrawResult | null>(null);
  const [result, setResult] = useState<RedrawResult | null>(null);

  // Reset + load the seated-player picker (needed for manual_custom) each open.
  useEffect(() => {
    if (!open) return;
    setMode("final_table"); setDrawMode("redraw_balanced"); setTargetCount("");
    setSelected(new Set()); setPhase("config"); setPreview(null); setResult(null);
    (async () => {
      const [{ data: tables }, { data: seats }] = await Promise.all([
        supabase.from("tournament_tables").select("id, table_id, table_number").eq("tournament_id", tournamentId),
        supabase.from("tournament_seats").select("entry_id, player_name, seat_number, table_id")
          .eq("tournament_id", tournamentId).eq("is_active", true),
      ]);
      const numByAny: Record<string, number | null> = {};
      (tables ?? []).forEach((t: any) => { if (t.table_id) { numByAny[t.id] = t.table_number; numByAny[t.table_id] = t.table_number; } });
      const list = (seats ?? []).filter((s: any) => s.entry_id).map((s: any) => ({
        entry_id: s.entry_id as string,
        player_name: (s.player_name as string) || (s.entry_id as string).slice(0, 6),
        table_number: numByAny[s.table_id] ?? null,
        seat_number: s.seat_number as number,
      })).sort((a, b) => (a.table_number ?? 0) - (b.table_number ?? 0) || a.seat_number - b.seat_number);
      setPlayers(list);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tournamentId]);

  const callRedraw = async (dryRun: boolean): Promise<RedrawResult | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source 20260918000000; not in generated types yet
    const { data, error } = await (supabase.rpc as any)("redraw_tournament", {
      p_tournament_id: tournamentId,
      p_mode: mode,
      p_eligible_entry_ids: mode === "manual_custom" ? Array.from(selected) : null,
      p_target_table_count: mode === "table_count_threshold" && targetCount.trim() ? Number(targetCount) : null,
      p_draw_mode: drawMode,
      p_dry_run: dryRun,
    });
    if (error) { toast.error(mapError(null, error.message)); return null; }
    return (data ?? null) as RedrawResult | null;
  };

  const runPreview = async () => {
    if (mode === "manual_custom" && selected.size === 0) { toast.error("Hãy chọn ít nhất 1 người chơi."); return; }
    setBusy(true);
    try {
      const r = await callRedraw(true);
      if (!r) return;
      if (!r.ok) { toast.error(mapError(r)); return; }
      setPreview(r); setPhase("preview");
    } finally { setBusy(false); }
  };

  const runConfirm = async () => {
    setBusy(true);
    try {
      const r = await callRedraw(false);
      if (!r) return;
      if (!r.ok) { toast.error(mapError(r)); return; }
      setResult(r); setPhase("done");
      toast.success(`Đã bốc lại ${r.moved_count ?? 0} người`);
      onDone();
    } finally { setBusy(false); }
  };

  const close = (v: boolean) => { if (!busy) onOpenChange(v); };
  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const moves = preview?.moves ?? [];
  const closing = preview?.tables_to_close ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shuffle className="w-4 h-4 text-primary" /> Bốc lại bàn (redraw)</DialogTitle>
          <DialogDescription>
            {phase === "config" && "Chọn kiểu bốc lại rồi xem trước trước khi xác nhận."}
            {phase === "preview" && "Xem trước kế hoạch bốc lại. Bấm xác nhận để áp dụng."}
            {phase === "done" && "Đã bốc lại xong."}
          </DialogDescription>
        </DialogHeader>

        {phase === "config" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Kiểu bốc lại</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as Mode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {mode === "table_count_threshold" && (
              <div>
                <Label className="text-xs">Gộp còn mấy bàn? (để trống = 3)</Label>
                <Input type="number" min={1} value={targetCount} onChange={(e) => setTargetCount(e.target.value)} placeholder="3" className="h-9" />
              </div>
            )}
            {mode === "manual_custom" && (
              <div>
                <Label className="text-xs">Chọn người chơi để bốc lại ({selected.size})</Label>
                <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                  {players.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">Không có người chơi đang ngồi.</div>
                  ) : players.map((p) => (
                    <label key={p.entry_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(p.entry_id)} onChange={() => toggle(p.entry_id)} />
                      <span className="truncate flex-1">{p.player_name}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">Bàn {p.table_number ?? "?"} · Ghế {p.seat_number}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Cách xếp chỗ</Label>
              <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="redraw_balanced">Bốc ngẫu nhiên, ưu tiên bàn ít người (mặc định)</SelectItem>
                  <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {phase === "preview" && preview && (
          <div className="space-y-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              Bốc lại <b>{preview.eligible ?? moves.length}</b> người vào <b>{preview.target_table_count ?? "?"}</b> bàn
              {closing.length > 0 && <> · đóng <b>{closing.length}</b> bàn ({closing.map((c) => c.table_number).join(", ")})</>}.
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Đây là bản xem trước. Khi xác nhận, hệ thống bốc lại lần nữa — <b>vị trí ghế cụ thể có thể khác</b> bản xem trước (bốc ngẫu nhiên); số người & số bàn thì không đổi.
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {moves.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs rounded-md border border-border bg-card/40 px-2.5 py-1.5">
                  <span className="truncate font-medium">{m.player_name}</span>
                  <span className="text-muted-foreground shrink-0">
                    Bàn {m.from_table_number ?? "?"}·G{m.from_seat} → <span className="text-primary">Bàn {m.to_table_number ?? "?"}·G{m.to_seat_number}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <div className="rounded-md border border-emerald-600/40 bg-emerald-950/20 p-3 text-sm flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Đã bốc lại {result.moved_count ?? 0} người
            {(result.tables_closed?.length ?? 0) > 0 && <> · đóng {result.tables_closed!.length} bàn ({result.tables_closed!.map((c) => c.table_number).join(", ")})</>}.
            Phiếu mới đã được phát cho từng người (xem ở sơ đồ bàn).
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "config" && (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={busy}>Huỷ</Button>
              <Button onClick={runPreview} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />} Xem trước
              </Button>
            </>
          )}
          {phase === "preview" && (
            <>
              <Button variant="outline" onClick={() => setPhase("config")} disabled={busy}>Sửa lại</Button>
              <Button onClick={runConfirm} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Shuffle className="w-4 h-4 mr-1" />} Xác nhận bốc lại
              </Button>
            </>
          )}
          {phase === "done" && <Button onClick={() => close(false)}>Xong</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
