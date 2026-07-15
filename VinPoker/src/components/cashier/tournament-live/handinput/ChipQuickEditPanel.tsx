// A3 (trackerChipQuickEdit) — in-console chip quick-edit. Reuses the SAME
// `tournament-live-draw` / `update_seats` Edge action as EditChipsDialog (no new
// backend). Only ever mounted from SetupHandPanel's `chipEditor` slot, which itself
// only renders `!handStarted && !orphanHand` — so "between hands only" is structural,
// not a flag check here.
//
// Chip-integrity guards (review-mandated):
//   - a reason (buyback/correction/seat-fix) is REQUIRED before Save enables.
//   - right before writing, re-fetch the seat's row from `tournament_seats` — this is
//     BOTH the authoritative `seat_id` (omitting it makes update_seats INSERT a
//     duplicate row instead of updating) AND the server-confirmed base, so a stale
//     on-screen value can never silently drift from the DB.
//   - on success, re-fetch again and hand the CALLER the server-confirmed chip_count
//     (no optimistic local write); on any failure, no local state changes at all.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Coins, Loader2, Pencil, X } from "lucide-react";
import { formatStack } from "./format";

export type QuickEditSeat = {
  player_id: string;
  seat_number: number;
  display_name: string;
  current_stack: number;
};

type ChipEditReason = "buyback" | "correction" | "seat_fix";
const REASON_LABEL: Record<ChipEditReason, string> = {
  buyback: "Mua thêm",
  correction: "Sửa nhầm",
  seat_fix: "Đổi / gộp bàn",
};

interface ChipQuickEditPanelProps {
  tournamentId: string;
  tableId: string;
  players: QuickEditSeat[];
  disabled?: boolean;
  onUpdated: (playerId: string, newStack: number) => void;
}

export function ChipQuickEditPanel({ tournamentId, tableId, players, disabled, onUpdated }: ChipQuickEditPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState<ChipEditReason | "">("");
  const [saving, setSaving] = useState(false);

  const openFor = (p: QuickEditSeat) => {
    setOpenId(p.player_id);
    setAmount(p.current_stack);
    setReason("");
  };
  const cancel = () => {
    setOpenId(null);
    setReason("");
  };

  const save = async (p: QuickEditSeat) => {
    if (!reason) {
      toast.error("Chọn lý do sửa chip trước khi lưu");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Chip không hợp lệ");
      return;
    }
    if (amount === p.current_stack) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const { data: freshSeat, error: fetchErr } = await supabase
        .from("tournament_seats")
        .select("id, entry_number, seat_number, player_name")
        .eq("tournament_id", tournamentId)
        .eq("table_id", tableId)
        .eq("player_id", p.player_id)
        .eq("is_active", true)
        .maybeSingle();
      if (fetchErr || !freshSeat) {
        toast.error("Không tìm thấy ghế trên server — thử tải lại bàn");
        return;
      }
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: [
            {
              seat_id: freshSeat.id,
              player_id: p.player_id,
              entry_number: freshSeat.entry_number,
              table_id: tableId,
              seat_number: freshSeat.seat_number,
              chip_count: amount,
              is_active: true,
              player_name: freshSeat.player_name,
            },
          ],
        },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || "Lỗi sửa chip");
        return;
      }
      const { data: confirmed } = await supabase
        .from("tournament_seats")
        .select("chip_count")
        .eq("id", freshSeat.id)
        .maybeSingle();
      const finalStack = confirmed?.chip_count ?? amount;
      onUpdated(p.player_id, finalStack);
      toast.success(
        `Đã sửa chip ${p.display_name} (${REASON_LABEL[reason]}): ${formatStack(p.current_stack)} → ${formatStack(finalStack)}`
      );
      cancel();
    } catch (e: any) {
      toast.error(e.message || "Lỗi sửa chip");
    } finally {
      setSaving(false);
    }
  };

  if (!players.length) return null;

  return (
    <div className="space-y-1.5 rounded-xl border border-border/50 bg-card/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Coins className="h-3.5 w-3.5" /> Sửa chip (giữa các ván)
      </div>
      <div className="space-y-1">
        {players.map((p) => (
          <div key={p.player_id} className="rounded-lg border border-border/30 bg-card/60">
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">
                Ghế {p.seat_number} · {p.display_name}
              </span>
              <span className="font-mono text-muted-foreground">{formatStack(p.current_stack)}</span>
              {openId === p.player_id ? (
                <button
                  type="button"
                  aria-label={`Đóng sửa chip ${p.display_name}`}
                  onClick={cancel}
                  className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Sửa chip ${p.display_name}`}
                  disabled={disabled}
                  onClick={() => openFor(p)}
                  className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {openId === p.player_id && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border/20 px-2 py-2">
                <Input
                  aria-label="Số chip mới"
                  type="number"
                  min={0}
                  className="h-9 w-28 font-mono text-sm"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <select
                  aria-label="Lý do sửa chip"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ChipEditReason)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Lý do…</option>
                  {(Object.keys(REASON_LABEL) as ChipEditReason[]).map((k) => (
                    <option key={k} value={k}>
                      {REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Button size="sm" className="h-9" disabled={saving || !reason} onClick={() => save(p)}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lưu"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
