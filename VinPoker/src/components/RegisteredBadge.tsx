import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Hourglass, Loader2, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import { fetchBuyinReceipt, toSeatReceiptData, type BuyinReceiptSnapshot } from "@/components/tournament/seat/buyinReceipt";

type Registration = {
  id: string;
  status: string;
  tournamentName: string;
};

const STATUS_VI: Record<string, string> = {
  pending: "Chờ thanh toán",
  confirmed: "Đã xác nhận",
};

/**
 * Mobile entry point for the same server-backed buy-in receipt used by staff.
 * The badge never generates a code or calculates payment/seat state locally.
 */
export function RegisteredBadge() {
  const { user } = useAuth();
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<BuyinReceiptSnapshot | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const fetchRegistration = useCallback(async () => {
    if (!user) {
      setRegistration(null);
      return;
    }
    const { data } = await supabase
      .from("tournament_registrations")
      .select("id, status, tournament_id")
      .eq("player_id", user.id)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(8);
    const registrations = (data ?? []) as Array<{ id: string; status: string; tournament_id: string }>;
    if (!registrations.length) {
      setRegistration(null);
      return;
    }

    const tournamentIds = Array.from(new Set(registrations.map((row) => row.tournament_id).filter(Boolean)));
    const { data: tournaments } = await supabase
      .from("tournaments")
      .select("id, name, status")
      .in("id", tournamentIds.length ? tournamentIds : ["00000000-0000-0000-0000-000000000000"]);
    const tournamentById = new Map(((tournaments ?? []) as Array<{ id: string; name: string; status: string }>).map((row) => [row.id, row]));
    const active = registrations.find((row) => !["completed", "cancelled"].includes(tournamentById.get(row.tournament_id)?.status ?? ""));
    if (!active) {
      setRegistration(null);
      return;
    }

    setRegistration({
      id: active.id,
      status: active.status,
      tournamentName: tournamentById.get(active.tournament_id)?.name ?? "Giải đấu",
    });
  }, [user]);

  useEffect(() => {
    void fetchRegistration();
    const onRegistrationChange = () => { void fetchRegistration(); };
    window.addEventListener("vinpoker:registration-changed", onRegistrationChange);
    return () => window.removeEventListener("vinpoker:registration-changed", onRegistrationChange);
  }, [fetchRegistration]);

  useEffect(() => {
    let current = true;
    const registrationId = registration?.id;
    if (!open || !registrationId) {
      setReceipt(null);
      setReceiptLoading(false);
      return () => { current = false; };
    }
    setReceiptLoading(true);
    void fetchBuyinReceipt({ registrationId }).then((snapshot) => {
      if (!current) return;
      setReceipt(snapshot);
      setReceiptLoading(false);
    });
    return () => { current = false; };
  }, [open, registration?.id]);

  if (!registration) return null;

  const confirmedReceipt = receipt?.status === "confirmed" && receipt.receipt_code
    ? toSeatReceiptData(receipt)
    : null;

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
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/40 bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground shadow-lg shadow-primary/30 md:hidden"
          aria-label="Xem phiếu đăng ký"
        >
          <BadgeCheck className="h-3.5 w-3.5" /> Đã đăng ký
        </motion.button>
      </AnimatePresence>

      {confirmedReceipt ? (
        <SeatReceiptDialog open={open} onOpenChange={setOpen} receipt={confirmedReceipt} />
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="mb-[env(safe-area-inset-bottom)] w-[calc(100%-1.5rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-primary" /> Phiếu đăng ký
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="font-semibold">{registration.tournamentName}</div>
              <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {STATUS_VI[receipt?.status ?? registration.status] ?? receipt?.status ?? registration.status}
              </span>
              {receiptLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải phiếu...</div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning">
                  <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{receipt?.status === "confirmed" ? "Đã xác nhận, đang cấp phiếu xếp chỗ." : "Đang chờ xác nhận chuyển khoản. Phiếu buy-in sẽ tự hiện tại đây sau khi hệ thống xếp chỗ."}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
