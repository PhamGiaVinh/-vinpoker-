import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { PokerCard } from "../PokerVisuals";
import { supabase } from "@/integrations/supabase/client";
import { formatStack, formatTime } from "@/lib/format";
import { formatViewerBBOrUnavailable } from "@/lib/tracker-poker/viewerAmounts";
import { parsePublicTableHistoryPage } from "./publicTableHistory";
import type { PublicTableHistoryItem } from "./publicSnapshotTypes";
import type { ReplayTarget } from "./replayTarget";

const PAGE_SIZE = 20;

export function TableHistoryPanel({
  tournamentId,
  tableId,
  currentSessionId,
  onSelectHand,
  onAccessRevoked,
}: {
  tournamentId: string;
  tableId: string | null;
  currentSessionId: string | null;
  onSelectHand: (target: ReplayTarget) => void;
  onAccessRevoked: () => void;
}) {
  const [items, setItems] = useState<PublicTableHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; handId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const requestGenerationRef = useRef(0);

  const load = useCallback(async (append: boolean) => {
    const generation = ++requestGenerationRef.current;
    if (!tableId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const cursor = append ? nextCursor : null;
    const { data, error: rpcError } = await supabase.rpc("get_public_tournament_table_history_v2" as never, {
      p_tournament_id: tournamentId,
      p_tournament_table_id: tableId,
      p_limit: PAGE_SIZE,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.handId ?? null,
    } as never);
    if (generation !== requestGenerationRef.current) return;
    if (rpcError) {
      setError("Không thể tải lịch sử bàn. Dữ liệu đang hiển thị vẫn được giữ nguyên.");
      setLoading(false);
      return;
    }
    const page = parsePublicTableHistoryPage(data, tournamentId, tableId);
    if (!page) {
      setError("Dữ liệu lịch sử không hợp lệ.");
      setLoading(false);
      return;
    }
    if (page.access === "revoked") {
      setItems([]);
      setNextCursor(null);
      setRevoked(true);
      setLoading(false);
      onAccessRevoked();
      return;
    }
    setItems((previous) => append ? [...previous, ...page.items.filter((item) => !previous.some((seen) => seen.handId === item.handId))] : page.items);
    setNextCursor(page.nextCursor);
    setLoading(false);
  }, [nextCursor, onAccessRevoked, tableId, tournamentId]);

  useEffect(() => {
    // Invalidate a response from the previous physical table/session before
    // rendering any loading state for the new context.
    requestGenerationRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setRevoked(false);
    setError(null);
    void load(false);
  // The panel is remounted by its table identity. Do not reload on nextCursor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, tableId]);

  if (!tableId) return <div className="rounded-2xl border border-dashed border-border/55 px-5 py-12 text-center text-sm text-muted-foreground">Chọn một bàn để xem lịch sử.</div>;
  if (revoked) return <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-12 text-center text-sm text-muted-foreground">Lịch sử bàn không còn được công khai.</div>;

  return <section className="space-y-3" aria-label="Lịch sử bàn chơi">
    <header className="flex items-center gap-2 rounded-2xl border border-border/55 bg-card/55 px-4 py-3">
      <History className="h-4 w-4 text-[hsl(var(--viewer-neon))]" />
      <div><h2 className="text-sm font-black">Lịch sử bàn chơi</h2><p className="text-xs text-muted-foreground">Các phiên của bàn này trong đúng giải đang xem.</p></div>
    </header>
    {error && <p role="status" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
    {loading && items.length === 0 ? <div className="grid min-h-40 place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Đang tải lịch sử…</div> : null}
    {!loading && items.length === 0 && !error ? <div className="rounded-2xl border border-dashed border-border/55 px-5 py-12 text-center text-sm text-muted-foreground">Bàn này chưa có ván đã hoàn tất.</div> : null}
    <div className="space-y-2">
      {items.map((item) => {
        const bb = item.bigBlind ?? 0;
        const pot = item.pot == null ? "—" : formatViewerBBOrUnavailable(item.pot, bb) === "— BB" ? `${formatStack(item.pot)} · — BB` : formatViewerBBOrUnavailable(item.pot, bb);
        const sessionLabel = item.tableSessionId === currentSessionId ? "Phiên hiện tại" : item.tableSessionId ? `Phiên ${item.tableSessionId.slice(0, 8)}` : "Phiên chưa xác định";
        return <button key={item.handId} type="button" onClick={() => onSelectHand({ handId: item.handId, tableId: item.tableId, handNumber: item.handNumber })} className="block min-h-11 w-full rounded-2xl border border-border/55 bg-card/55 px-3 py-3 text-left transition hover:border-[hsl(var(--viewer-neon)_/_0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">Hand #{item.handNumber ?? "—"}</span><span className="text-[11px] text-muted-foreground">{formatTime(item.createdAt)} · {sessionLabel}</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="tracker-num text-[hsl(var(--viewer-neon))]">Pot {pot}</span>{item.board.map((card, index) => <PokerCard key={`${index}:${card}`} card={card} size="xs" />)}</div>
        </button>;
      })}
    </div>
    {nextCursor && <button type="button" disabled={loading} onClick={() => void load(true)} className="inline-flex min-h-11 items-center rounded-xl border border-border/60 px-3 text-xs font-bold disabled:opacity-50">{loading ? "Đang tải…" : "Tải thêm"}</button>}
  </section>;
}
