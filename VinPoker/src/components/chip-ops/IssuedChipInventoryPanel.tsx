import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, CheckCircle2, AlertTriangle, Lock } from "lucide-react";

// Local types — the chip_ops_* migration is source-only/unapplied, so get_issued_chip_inventory
// is not yet in the generated Database types. The RPC call is cast to keep the build green and
// degrades gracefully (error path) until the migration is applied + types regenerated.
interface InvDenom {
  denomination_id: string;
  value: number;
  color: string | null;
  issued_count_total: number;
}
interface Inventory {
  tournament_id: string;
  denominations: InvDenom[];
  total_value: number;
  reconciliation_value: number;
  reconciled: boolean;
  error?: string;
}
interface TourRow {
  id: string;
  name: string | null;
}

const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");

/** Strictly READ-ONLY Issued-Chip-Inventory viewer. Calls get_issued_chip_inventory; no writes. */
export function IssuedChipInventoryPanel() {
  const { isClubOwner, isChipMaster } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tours, setTours] = useState<TourRow[]>([]);
  const [tournamentId, setTournamentId] = useState<string>(params.get("t") ?? "");
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const allowed = isClubOwner || isChipMaster;

  // Tournament list (RLS-scoped). May be empty for a chip-master-only user — they can still open
  // a specific tournament via ?t=<id>.
  useEffect(() => {
    let active = true;
    supabase
      .from("tournaments")
      .select("id,name,start_time")
      .order("start_time", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (active) setTours((data ?? []).map((t: any) => ({ id: t.id, name: t.name })));
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch the server-computed inventory for the selected tournament.
  useEffect(() => {
    if (!tournamentId) {
      setInv(null);
      setErrMsg(null);
      return;
    }
    let active = true;
    setLoading(true);
    setErrMsg(null);
    (supabase as any)
      .rpc("get_issued_chip_inventory", { p_tournament_id: tournamentId })
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error) {
          setInv(null);
          setErrMsg("Chưa thể đọc tồn kho chip (tính năng chưa bật trên máy chủ).");
          return;
        }
        const d = data as Inventory;
        if (d?.error) {
          setInv(null);
          setErrMsg(
            d.error === "Forbidden"
              ? "Bạn không có quyền xem tồn kho chip của giải này."
              : "Không tìm thấy giải đấu.",
          );
          return;
        }
        setInv(d);
      })
      .catch(() => {
        if (active) {
          setInv(null);
          setErrMsg("Chưa thể đọc tồn kho chip.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const onPick = (id: string) => {
    setTournamentId(id);
    const next = new URLSearchParams(params);
    next.set("t", id);
    setParams(next, { replace: true });
  };

  if (!allowed) {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <Lock className="w-5 h-5" /> Bạn không có quyền truy cập Chip Ops.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Coins className="w-5 h-5 text-primary" /> Tồn kho chip đã phát
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Chỉ xem — số chip mỗi mệnh giá được máy chủ tính từ mẫu stack × số bộ đã phát.
          </p>
        </CardHeader>
        <CardContent>
          <Select value={tournamentId} onValueChange={onPick}>
            <SelectTrigger className="w-full sm:w-[320px]">
              <SelectValue placeholder="Chọn giải đấu" />
            </SelectTrigger>
            <SelectContent>
              {tours.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name ?? t.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading && (
        <Card className="border-border">
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && errMsg && (
        <Card className="border-border">
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <AlertTriangle className="w-5 h-5 text-warning" /> {errMsg}
          </CardContent>
        </Card>
      )}

      {!loading && !errMsg && inv && (
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base text-foreground">Theo mệnh giá</CardTitle>
            {inv.reconciled ? (
              <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary">
                <CheckCircle2 className="w-3.5 h-3.5" /> Khớp số
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Lệch số
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {inv.denominations.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Chưa có mẫu stack hoặc chưa phát bộ nào cho giải này.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mệnh giá</TableHead>
                    <TableHead className="text-right">Số chip đã phát</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.denominations.map((d) => (
                    <TableRow key={d.denomination_id}>
                      <TableCell className="flex items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 shrink-0 rounded-full border border-border"
                          style={{ backgroundColor: d.color ?? "transparent" }}
                          aria-hidden
                        />
                        <span className="tabular-nums">{fmt(d.value)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(d.issued_count_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Tổng giá trị</span>
              <span className="font-semibold tabular-nums text-foreground">{fmt(inv.total_value)}</span>
            </div>
            {!inv.reconciled && (
              <p className="mt-2 text-xs text-destructive">
                Đối soát lệch: tổng theo mệnh giá ({fmt(inv.total_value)}) ≠ tổng theo mẫu stack (
                {fmt(inv.reconciliation_value)}).
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default IssuedChipInventoryPanel;
