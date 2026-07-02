import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { useAuth } from "@/hooks/useAuth";
import { useFnbClubs } from "@/hooks/useFnbClubs";
import { useFnbLinkTargets } from "@/hooks/useFnbLinkTargets";
import { useFnbServeQueue, type FnbServeOrder } from "@/hooks/useFnbServe";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wallet, Bell } from "lucide-react";

/**
 * F&B GUEST-ORDER SERVER SURFACE (/fnb/serve) — the "phục vụ đến bàn thu tiền mặt" queue. Phone-first.
 * Shows TABLE-source CASH orders still pending (guest QR orders paying by cash); the server walks to
 * the table, collects cash, taps "Đã thu" → fnb_mark_paid (M3 allows the server facet for table+cash).
 * Realtime drops paid orders off. Gate: fnbModule && fnbGuestOrder, role isFnbServer || owner/admin.
 */
export default function FnbServe() {
  if (!FEATURES.fnbModule || !FEATURES.fnbGuestOrder) return <Navigate to="/" replace />;
  return <FnbServeInner />;
}

function FnbServeInner() {
  const { loading: authLoading, isFnbServer, isFnbCashier, isClubOwner, isAdmin, isFnb } = useAuth();
  const { clubs } = useFnbClubs();
  const [clubId, setClubId] = useState("");
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const canServe = isFnbServer || isFnbCashier || isClubOwner || isAdmin; // server re-enforces
  const isOperator = isFnb || isClubOwner || isAdmin;

  if (authLoading || clubs === null) {
    return <div className="container mx-auto max-w-2xl px-4 py-6 space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!isOperator) {
    return <div className="container mx-auto max-w-2xl px-4 py-6"><Card><CardContent className="py-6 text-sm text-muted-foreground">Khu vực phục vụ F&amp;B chỉ dành cho nhân viên.</CardContent></Card></div>;
  }
  if (clubs.length === 0) {
    return <div className="container mx-auto max-w-2xl px-4 py-6"><Card><CardContent className="py-6 text-sm text-muted-foreground">Bạn chưa được gán vào câu lạc bộ F&amp;B nào.</CardContent></Card></div>;
  }

  const activeClub = clubId || clubs[0].id;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Bell className="w-5 h-5 text-primary" /> F&amp;B · Phục vụ</h1>
          <p className="text-xs text-muted-foreground">Đơn khách gọi qua QR, trả tiền mặt — đến bàn thu tiền rồi bấm “Đã thu”.</p>
        </div>
        {clubs.length > 1 && (
          <div className="w-full max-w-xs">
            <Label className="mb-1 block text-xs text-muted-foreground">Câu lạc bộ</Label>
            <Select value={activeClub} onValueChange={setClubId}>
              <SelectTrigger className="bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!canServe && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bạn chưa có vai trò Phục vụ/Thu ngân — không thể thu tiền (chủ CLB cấp quyền ở Quản trị → Nhân sự).
        </div>
      )}

      <ServeQueue clubId={activeClub} canServe={canServe} busyId={busyId} onPay={async (o) => {
        setBusyId(o.id);
        const { data, error } = await (supabase.rpc as any)("fnb_mark_paid", { p_order_id: o.id });
        setBusyId(null);
        const res = data as any;
        if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); qc.invalidateQueries({ queryKey: ["fnb", "serve", activeClub] }); return; }
        toast.success(res?.idempotent ? "Đơn đã thu trước đó." : "Đã thu tiền — đơn xuống bếp.");
        qc.invalidateQueries({ queryKey: ["fnb", "serve", activeClub] });
      }} />
    </div>
  );
}

function ServeQueue({ clubId, canServe, busyId, onPay }: {
  clubId: string; canServe: boolean; busyId: string | null; onPay: (o: FnbServeOrder) => void;
}) {
  const { data, isLoading } = useFnbServeQueue(clubId);
  const { data: linkTargets } = useFnbLinkTargets(clubId);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const orders = data ?? [];
  if (orders.length === 0) {
    return <div className="rounded-lg border border-border bg-muted/20 py-10 text-center text-sm text-muted-foreground">Chưa có đơn nào cần thu tiền mặt.</div>;
  }
  const tableName = (ref: string | null) => (ref ? linkTargets?.tables.find((t) => t.id === ref)?.table_name : null);
  return (
    <div className="grid gap-3">
      {orders.map((o) => (
        <Card key={o.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold truncate">
              {tableName(o.table_ref) ?? "Bàn"}{o.guest_seat ? ` · Ghế ${o.guest_seat}` : ""}
              {o.customer_name ? ` · ${o.customer_name}` : ""}
            </div>
            <div className="font-mono text-lg font-semibold shrink-0">{formatVND(o.subtotal_vnd)}</div>
          </div>
          <div className="text-sm text-muted-foreground">
            {o.items.map((it) => `${it.qty}× ${it.name_snapshot}`).join(", ") || "—"}
          </div>
          {o.note ? <div className="text-xs text-warning">Ghi chú: {o.note}</div> : null}
          <div className="pt-1">
            <Button className="w-full h-11 bg-success hover:bg-success/90 text-success-foreground"
              disabled={!canServe || busyId === o.id} onClick={() => onPay(o)}>
              {busyId === o.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wallet className="w-4 h-4 mr-1" />}
              Đã thu tiền mặt
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
