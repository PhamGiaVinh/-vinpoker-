import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BadgeCheck, MapPin, Copy, Hourglass, Ticket } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type Reg = {
  id: string;
  status: string;
  reference_code: string | null;
  tournament_id: string;
  tournamentName: string;
  tournamentDate: string | null;
};
type Seat = { table_number: number | null; seat_number: number; receipt_code: string } | null;

const STATUS_VI: Record<string, string> = {
  pending: "Chờ thanh toán",
  confirmed: "Đã xác nhận",
};

/**
 * Mobile-only "Đã đăng ký" pill floating just above the center bottom-nav logo.
 * Appears as soon as the signed-in player has an active tournament registration;
 * tapping it opens a receipt (reference code + QR + table/seat once the floor has
 * drawn the seat, otherwise "Chờ xếp bàn/ghế"). Additive — never alters the nav.
 * (OneSignal push to be wired later.)
 */
export function RegisteredBadge() {
  const { user } = useAuth();
  const [reg, setReg] = useState<Reg | null>(null);
  const [seat, setSeat] = useState<Seat>(null);
  const [open, setOpen] = useState(false);

  const fetchReg = useCallback(async () => {
    if (!user) { setReg(null); setSeat(null); return; }
    const { data } = await supabase
      .from("tournament_registrations")
      .select("id, status, reference_code, tournament_id, tournaments(name, start_time, status)")
      .eq("player_id", user.id)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(8);
    const rows = (data ?? []) as any[];
    // Most recent active registration whose tournament is still upcoming/running.
    const active = rows.find((r) => {
      const ts = r.tournaments?.status as string | undefined;
      return ts ? !["completed", "cancelled"].includes(ts) : true;
    });
    if (!active) { setReg(null); setSeat(null); return; }
    setReg({
      id: active.id,
      status: active.status,
      reference_code: active.reference_code ?? null,
      tournament_id: active.tournament_id,
      tournamentName: active.tournaments?.name ?? "Giải đấu",
      tournamentDate: active.tournaments?.start_time ?? null,
    });
    const { data: rec } = await supabase
      .from("seat_draw_receipts")
      .select("table_number, seat_number, receipt_code")
      .eq("player_id", user.id)
      .eq("tournament_id", active.tournament_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSeat((rec as Seat) ?? null);
  }, [user]);

  useEffect(() => {
    fetchReg();
    const onChange = () => fetchReg();
    window.addEventListener("vinpoker:registration-changed", onChange);
    return () => window.removeEventListener("vinpoker:registration-changed", onChange);
  }, [fetchReg]);

  if (!reg) return null;

  const qrValue = seat?.receipt_code || reg.reference_code || reg.id;
  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success("Đã sao chép");
  };

  return (
    <>
      <AnimatePresence>
        <motion.button
          key="reg-pill"
          type="button"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 26 }}
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/40 bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground shadow-lg shadow-primary/30 md:hidden bottom-[calc(72px+env(safe-area-inset-bottom))]"
          aria-label="Xem phiếu đăng ký"
        >
          <BadgeCheck className="h-3.5 w-3.5" /> Đã đăng ký
        </motion.button>
      </AnimatePresence>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-primary" /> Phiếu đăng ký
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <div className="font-semibold">{reg.tournamentName}</div>
              {reg.tournamentDate && (
                <div className="text-xs text-muted-foreground">{formatDateTime(reg.tournamentDate)}</div>
              )}
              <span className="mt-1 inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {STATUS_VI[reg.status] ?? reg.status}
              </span>
            </div>

            <div className="flex justify-center rounded-lg border border-border bg-card p-3">
              <QRCodeSVG value={qrValue} size={132} includeMargin />
            </div>

            <button
              type="button"
              onClick={() => copy(qrValue)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left"
            >
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mã tham chiếu</div>
                <div className="font-mono text-sm font-semibold">{qrValue}</div>
              </div>
              <Copy className="h-4 w-4 text-muted-foreground" />
            </button>

            {seat ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-success">
                <MapPin className="h-4 w-4 shrink-0" />
                <div className="text-sm font-semibold">
                  Bàn {seat.table_number ?? "—"} · Ghế {seat.seat_number}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning">
                <Hourglass className="h-4 w-4 shrink-0" />
                <div className="text-sm">Chờ xếp bàn/ghế — sàn sẽ xếp chỗ trước giờ chơi.</div>
              </div>
            )}

            <p className="text-center text-[11px] text-muted-foreground">
              Đưa mã QR này cho thu ngân để xác nhận thanh toán & nhận chỗ.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
