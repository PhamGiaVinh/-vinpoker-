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
type Seat = { table_number: number | null; seat_number: number } | null;

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
    // NOTE: tournament_registrations.tournament_id has NO FK to tournaments, so a
    // PostgREST embed (tournaments(...)) fails — fetch the tournaments separately.
    const { data } = await supabase
      .from("tournament_registrations")
      .select("id, status, reference_code, tournament_id")
      .eq("player_id", user.id)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(8);
    const rows = (data ?? []) as any[];
    if (!rows.length) { setReg(null); setSeat(null); return; }
    const tourIds = Array.from(new Set(rows.map((r) => r.tournament_id).filter(Boolean)));
    const { data: tours } = await supabase
      .from("tournaments")
      .select("id, name, start_time, status")
      .in("id", tourIds.length ? tourIds : ["00000000-0000-0000-0000-000000000000"]);
    const tourMap = Object.fromEntries(((tours ?? []) as any[]).map((tt) => [tt.id, tt]));
    // Most recent active registration whose tournament is still upcoming/running.
    const active = rows.find((r) => {
      const ts = tourMap[r.tournament_id]?.status as string | undefined;
      return ts ? !["completed", "cancelled"].includes(ts) : true;
    });
    if (!active) { setReg(null); setSeat(null); return; }
    const tour = tourMap[active.tournament_id];
    setReg({
      id: active.id,
      status: active.status,
      reference_code: active.reference_code ?? null,
      tournament_id: active.tournament_id,
      tournamentName: tour?.name ?? "Giải đấu",
      tournamentDate: tour?.start_time ?? null,
    });
  }, [user]);

  // LIVE seat from tournament_seats (NOT the seat_draw_receipts print, which goes
  // stale after a move). Resolves table_number via tournament_tables (a seat's
  // table_id may reference tournament_tables.id OR game_tables.id — match both).
  const fetchSeat = useCallback(async (tid: string) => {
    if (!user) { setSeat(null); return; }
    const { data: seatRows } = await supabase
      .from("tournament_seats")
      .select("seat_number, table_id")
      .eq("tournament_id", tid)
      .eq("player_id", user.id)
      .eq("is_active", true)
      .limit(1);
    const s = ((seatRows ?? []) as any[])[0];
    if (!s) { setSeat(null); return; }
    let tableNumber: number | null = null;
    if (s.table_id) {
      const { data: tt } = await supabase
        .from("tournament_tables")
        .select("table_number")
        .eq("tournament_id", tid)
        .or(`id.eq.${s.table_id},table_id.eq.${s.table_id}`)
        .limit(1)
        .maybeSingle();
      tableNumber = (tt as any)?.table_number ?? null;
    }
    setSeat({ table_number: tableNumber, seat_number: s.seat_number });
  }, [user]);

  useEffect(() => {
    fetchReg();
    const onChange = () => fetchReg();
    window.addEventListener("vinpoker:registration-changed", onChange);
    return () => window.removeEventListener("vinpoker:registration-changed", onChange);
  }, [fetchReg]);

  // Seat + realtime: refetch the live seat whenever the active tournament's seats
  // change (e.g. the floor moves/seats the player). tournament_seats is in the
  // realtime publication, so the receipt updates without a manual refresh.
  useEffect(() => {
    if (!reg) { setSeat(null); return; }
    const tid = reg.tournament_id;
    fetchSeat(tid);
    const ch = supabase
      .channel(`reg-badge-seat:${tid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tid}` },
        () => fetchSeat(tid),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reg?.tournament_id, fetchSeat]);

  if (!reg) return null;

  const qrValue = reg.reference_code || reg.id;
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
