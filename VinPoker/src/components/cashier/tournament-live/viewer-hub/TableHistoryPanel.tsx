import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PokerCard } from "../PokerVisuals";
import { supabase } from "@/integrations/supabase/client";
import { formatTime } from "@/lib/format";
import { formatViewerChipAndBB, formatViewerChipCompact, formatViewerSignedChipAndBB } from "@/lib/tracker-poker/viewerAmounts";
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
  const { t } = useTranslation();
  const [items, setItems] = useState<PublicTableHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; handId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const context = `${tournamentId}:${tableId ?? ""}`;

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
      setLoadedContext(null);
      setRevoked(true);
      setLoading(false);
      onAccessRevoked();
      return;
    }
    setItems((previous) => append ? [...previous, ...page.items.filter((item) => !previous.some((seen) => seen.handId === item.handId))] : page.items);
    setNextCursor(page.nextCursor);
    setLoadedContext(context);
    setLoading(false);
  }, [context, nextCursor, onAccessRevoked, tableId, tournamentId]);

  useEffect(() => {
    // Invalidate a response from the previous physical table/session before
    // rendering any loading state for the new context.
    requestGenerationRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setLoadedContext(null);
    setRevoked(false);
    setError(null);
    void load(false);
    return () => { requestGenerationRef.current += 1; };
  // The panel is remounted by its table identity. Do not reload on nextCursor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, tableId]);

  useEffect(() => {
    if (revoked) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(false); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load, revoked]);

  const visibleItems = loadedContext === context ? items : [];
  const visibleCursor = loadedContext === context ? nextCursor : null;

  if (!tableId) return <div className="rounded-2xl border border-dashed border-border/55 px-5 py-12 text-center text-sm text-muted-foreground">Chọn một bàn để xem lịch sử.</div>;
  if (revoked) return <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-12 text-center text-sm text-muted-foreground">Lịch sử bàn không còn được công khai.</div>;

  return <section className="space-y-3" aria-label="Lịch sử bàn chơi">
    <header className="flex items-center gap-2 rounded-2xl border border-border/55 bg-card/55 px-4 py-3">
      <History className="h-4 w-4 text-[hsl(var(--viewer-neon))]" />
      <div><h2 className="text-sm font-black">Lịch sử bàn chơi</h2><p className="text-xs text-muted-foreground">Các phiên của bàn này trong đúng giải đang xem.</p></div>
    </header>
    {error && <p role="status" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
    {loading && visibleItems.length === 0 ? <div className="grid min-h-40 place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Đang tải lịch sử…</div> : null}
    {!loading && visibleItems.length === 0 && !error ? <div className="rounded-2xl border border-dashed border-border/55 px-5 py-12 text-center text-sm text-muted-foreground">Bàn này chưa có ván đã hoàn tất.</div> : null}
    <div className="space-y-2">
      {visibleItems.map((item) => {
        const sessionLabel = item.tableSessionId === currentSessionId ? "Phiên hiện tại" : item.tableSessionId ? `Phiên ${item.tableSessionId.slice(0, 8)}` : "Phiên chưa xác định";
        return <article key={item.handId} className="rounded-2xl border border-border/55 bg-card/70 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>Hand #{item.handNumber ?? "—"}</strong><span className="text-[11px] text-muted-foreground">{formatTime(item.createdAt)} · {sessionLabel}</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/45 bg-background/35 px-3 py-2 text-xs">
            <span className="tracker-num font-bold text-[hsl(var(--viewer-neon))]">Pot {formatViewerChipAndBB(item.pot, item.bigBlind)}</span>
            <span className="text-muted-foreground">{item.smallBlind != null && item.bigBlind != null ? `${formatViewerChipCompact(item.smallBlind)}/${formatViewerChipCompact(item.bigBlind)}` : t("tableHistory.blindUnavailable", "Blind —")}{item.ante != null ? ` · ${t("tableHistory.ante", "Ante")} ${formatViewerChipCompact(item.ante)}` : ""}</span>
          </div>
          {item.result.status === "verified" ? <div className="mt-3 divide-y divide-border/35">
            {item.result.recipients.map((recipient) => <div key={`${recipient.playerId}:${recipient.entryNumber ?? "legacy"}`} className="flex min-w-0 flex-wrap items-center gap-2 py-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[hsl(var(--poker-gold)/0.55)] bg-secondary text-xs font-bold" aria-hidden="true">{recipient.avatarUrl ? <img src={recipient.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : recipient.name.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{recipient.name}</span><span className="text-[10px] text-muted-foreground">{t("tableHistory.received", "Nhận")} {recipient.potKinds.map((kind) => t(`tableHistory.${kind}`, kind === "main" ? "pot chính" : "pot phụ")).join(" + ")}</span></span>
              {recipient.holeCards.length > 0 && <span className="flex shrink-0 gap-1" aria-label={t("tableHistory.publicCards", "Bài đã công khai của {{name}}", { name: recipient.name })}>{recipient.holeCards.map((card, index) => <PokerCard key={`${index}:${card}`} card={card} size="xs" />)}</span>}
              <span className={`tracker-num ml-auto text-sm font-bold ${recipient.netDelta > 0 ? "text-emerald-400" : recipient.netDelta < 0 ? "text-rose-400" : "text-muted-foreground"}`} aria-label={`${t("tableHistory.net", "Lãi ròng")} ${formatViewerSignedChipAndBB(recipient.netDelta, item.bigBlind)}`}>{formatViewerSignedChipAndBB(recipient.netDelta, item.bigBlind)}</span>
            </div>)}
          </div> : <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{t("tableHistory.pending", "Kết quả đang được kiểm tra")}</p>}
          {item.board.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/35 pt-3"><span className="mr-1 text-[10px] font-bold uppercase text-muted-foreground">Board</span>{item.board.map((card, index) => <PokerCard key={`${index}:${card}`} card={card} size="xs" />)}</div>}
          <button type="button" onClick={() => onSelectHand({ handId: item.handId, tableId: item.tableId, handNumber: item.handNumber })} className="mt-3 min-h-11 w-full rounded-xl border border-border/65 px-3 text-xs font-bold transition hover:border-[hsl(var(--viewer-neon)_/_0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("tableHistory.replay", "Xem lại hand")}</button>
        </article>;
      })}
    </div>
    {visibleCursor && <button type="button" disabled={loading} onClick={() => void load(true)} className="inline-flex min-h-11 items-center rounded-xl border border-border/60 px-3 text-xs font-bold disabled:opacity-50">{loading ? "Đang tải…" : "Tải thêm"}</button>}
  </section>;
}
