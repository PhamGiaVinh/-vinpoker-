import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Load-failure state — distinct from "empty" so the operator never mistakes a fetch
 *  error for "no tournaments" during live play [P1-4]. */
export function BoardError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center border-destructive/30">
      <AlertTriangle className="w-7 h-7 text-destructive/70" />
      <p className="text-sm text-muted-foreground">Không tải được danh sách giải. Kiểm tra kết nối rồi thử lại.</p>
      <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại</Button>
    </Card>
  );
}

/** Clean empty state with the create CTA. */
export function BoardEmpty({ icon, title, sub, create }: { icon: ReactNode; title: string; sub: string; create: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <div className="opacity-50">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
      {create && <div className="mt-2">{create}</div>}
    </Card>
  );
}
