import type { ReactNode } from "react";
import { TableProperties } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatVndShort } from "@/lib/clubFinance";
import type { EventEconomicsRow } from "@/lib/series-intelligence/commandCenter";

const countFmt = new Intl.NumberFormat("vi-VN");

/** A cell value; missing data renders as a muted "—" rather than a fabricated number. */
function num(v: number | null, fmt: (n: number) => string): ReactNode {
  if (v === null) return <span className="text-muted-foreground/50">—</span>;
  return <span className="tabular-nums">{fmt(v)}</span>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10); // YYYY-MM-DD (no locale parsing, deterministic)
}

/** Per-event economics. GTD shows an explicit "GTD missing" chip — never faked from prize pool. */
export function EconomicsTable({ rows }: { rows: EventEconomicsRow[] }) {
  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2">
        <TableProperties className="h-4 w-4 text-primary" /> Kinh tế từng giải
      </h3>
      <div className="-mx-2 overflow-x-auto">
        <Table className="min-w-[760px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Giải</TableHead>
              <TableHead className="text-right">Buy-in</TableHead>
              <TableHead className="text-right">Fee</TableHead>
              <TableHead className="text-right">Service</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Unique</TableHead>
              <TableHead className="text-right">Re-entry</TableHead>
              <TableHead className="text-right">Prize pool</TableHead>
              <TableHead className="text-right">GTD</TableHead>
              <TableHead className="text-right">Rake yield</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.event_id}>
                <TableCell className="max-w-[180px]">
                  <div className="truncate font-medium">{r.event_name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{fmtDate(r.event_date)}</div>
                </TableCell>
                <TableCell className="text-right">{num(r.buy_in, formatVndShort)}</TableCell>
                <TableCell className="text-right">{num(r.fee, formatVndShort)}</TableCell>
                <TableCell className="text-right">{num(r.serviceFeeAmount, formatVndShort)}</TableCell>
                <TableCell className="text-right">{num(r.total_entries, (n) => countFmt.format(n))}</TableCell>
                <TableCell className="text-right">{num(r.unique_entries, (n) => countFmt.format(n))}</TableCell>
                <TableCell className="text-right">{num(r.reentries, (n) => countFmt.format(n))}</TableCell>
                <TableCell className="text-right">{num(r.prize_pool_actual, formatVndShort)}</TableCell>
                <TableCell className="text-right">
                  <span className="text-[10px] text-warning">GTD missing</span>
                </TableCell>
                <TableCell className="text-right">
                  {num(r.rakeYieldPct, (n) => `${n.toFixed(1)}%`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[10px] text-muted-foreground/80">
        Số mô tả từ dữ liệu VinPoker — không phải báo cáo kế toán. "—" = chưa có dữ liệu. Rake yield =
        fee / buy-in (cần đối chiếu nghĩa buy-in khi UAT).
      </p>
    </Card>
  );
}
