/**
 * pages/DealerControlBoard.tsx — /dealer-board
 *
 * Full-screen dealer-control board (wall display). Dense grid of table cards
 * with BIG countdowns to swing_due_at, the rotation plan (✓ CHỐT / ~ DỰ ĐOÁN /
 * ⚠ THIẾU DEALER) per table, and a right rail with the dealer pool sorted by
 * prev_session_minutes.
 *
 * Feed: get_rotation_board(p_club_id) RPC on a 15s interval + realtime
 * invalidation on dealer_rotation_schedule / dealer_assignments changes.
 *
 * NOTE: get_rotation_board is not in the generated supabase types yet —
 * called with an `as any` cast and typed via local interfaces (same pattern
 * as other untyped RPCs in the repo).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLiveClock } from "@/hooks/useLiveClock";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, MonitorPlay, Users } from "lucide-react";

/* ── RPC payload contracts (get_rotation_board) ─────────────────────────── */

interface BoardSlot {
  schedule_id: string;
  slot_index: number;
  status: "predicted" | "announced" | "executing" | string;
  planned_relief_at: string | null;
  announce_at: string | null;
  is_shortage: boolean;
  is_emergency: boolean;
  in_attendance_id: string | null;
  in_dealer_name: string | null;
  in_dealer_tier: string | null;
}

interface BoardTable {
  table_id: string;
  table_name: string;
  tour_tier: string | null;
  assignment_id: string | null;
  assigned_at: string | null;
  swing_due_at: string | null;
  planned_relief_at: string | null;
  overtime_started_at: string | null;
  current_dealer: {
    attendance_id: string;
    full_name: string;
    tier: string | null;
  } | null;
  slots: BoardSlot[];
}

interface BoardPoolEntry {
  attendance_id: string;
  full_name: string;
  tier: string | null;
  current_state: string;
  last_released_at: string | null;
  prev_session_minutes: number | null;
}

interface RotationBoard {
  outcome: string;
  tables: BoardTable[];
  pool: BoardPoolEntry[];
}

type ClubRow = { id: string; name: string };

const REST_MINUTES = 10;
const POLL_MS = 15_000;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatHHmm(iso: string | null): string {
  if (!iso) return "--:--";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function tierBadgeClass(tier: string | null): string {
  return tier === "A"
    ? "bg-warning/20 text-warning border-warning/40"
    : tier === "B"
      ? "bg-[hsl(var(--ds-active))]/20 text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active))]/40"
      : "bg-muted text-foreground border-border";
}

const STATE_LABELS: Record<string, string> = {
  available: "Sẵn sàng",
  assigned: "Đang chia",
  pre_assigned: "Đã gán trước",
  on_break: "Đang nghỉ",
  checked_out: "Đã về",
};

/* ── Data feed ───────────────────────────────────────────────────────────── */

function useRotationBoard(clubIds: string[]) {
  const [board, setBoard] = useState<RotationBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const clubIdsKey = useMemo(() => [...clubIds].sort().join(","), [clubIds]);
  const clubIdsRef = useRef(clubIds);
  useEffect(() => { clubIdsRef.current = clubIds; }, [clubIds]);

  const refetch = useCallback(async () => {
    const gen = ++generationRef.current;
    const ids = clubIdsRef.current;
    if (!ids.length) { setBoard(null); setLoading(false); return; }
    try {
      const results = await Promise.all(
        ids.map((cid) => (supabase.rpc as any)("get_rotation_board", { p_club_id: cid })),
      );
      if (gen !== generationRef.current) return;
      const firstError = results.find((r: any) => r?.error)?.error;
      if (firstError) {
        console.error("[useRotationBoard] RPC error:", firstError);
        setError(firstError.message ?? String(firstError));
        setLoading(false);
        return;
      }
      const tables: BoardTable[] = [];
      const pool: BoardPoolEntry[] = [];
      for (const r of results as any[]) {
        const payload = r?.data as RotationBoard | null;
        if (!payload || payload.outcome !== "ok") continue;
        tables.push(...(payload.tables ?? []));
        pool.push(...(payload.pool ?? []));
      }
      setError(null);
      setBoard({ outcome: "ok", tables, pool });
    } catch (e) {
      if (gen !== generationRef.current) return;
      console.error("[useRotationBoard] threw:", e);
      setError((e as Error)?.message ?? "Unknown error");
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!clubIds.length) { setBoard(null); setLoading(false); return; }
    setLoading(true);
    refetch();

    // 15s polling
    const timer = window.setInterval(refetch, POLL_MS);

    // realtime invalidation on the two driving tables
    const instanceId = Math.random().toString(36).slice(2, 8);
    const channel = supabase.channel(`rotation-board:${clubIdsKey}:${instanceId}`);
    for (const table of ["dealer_rotation_schedule", "dealer_assignments"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => { refetch(); },
      );
    }
    channel.subscribe();

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubIdsKey]);

  return { board, loading, error, refetch };
}

/* ── Table card ──────────────────────────────────────────────────────────── */

function BoardTableCard({ table, nowMs }: { table: BoardTable; nowMs: number }) {
  const dueMs = table.swing_due_at ? new Date(table.swing_due_at).getTime() : null;
  const remainingSec = dueMs != null ? (dueMs - nowMs) / 1000 : null;
  const isOverdue = remainingSec != null && remainingSec < 0;

  const slot0 = table.slots?.find((s) => s.slot_index === 0) ?? null;
  const slot0Locked = !!slot0 && (slot0.status === "announced" || slot0.status === "executing");
  const slot0Predicted = !!slot0 && slot0.status === "predicted" && !slot0.is_shortage && !!slot0.in_attendance_id;
  const isShortage = !!slot0?.is_shortage || !slot0?.in_attendance_id;
  const forecastSlots = (table.slots ?? []).filter((s) => s.slot_index > 0 && s.in_attendance_id);

  const countdownLabel = remainingSec == null
    ? "--:--"
    : isOverdue
      ? `+${formatMmSs(-remainingSec)}`
      : formatMmSs(remainingSec);

  const countdownColor = remainingSec == null
    ? "text-muted-foreground"
    : isOverdue
      ? "text-destructive"
      : remainingSec <= 180
        ? "text-warning"
        : remainingSec <= 300
          ? "text-warning"
          : "text-success";

  return (
    <div className={[
      "relative flex flex-col rounded-xl border bg-card/80 overflow-hidden",
      isOverdue
        ? "border-destructive/60 shadow-[0_0_32px_-10px_rgba(239,68,68,0.5)]"
        : "border-border/60",
    ].join(" ")}>
      {/* Shortage banner */}
      {isShortage && (
        <div className="bg-destructive/90 text-destructive text-sm font-bold text-center py-1.5 tracking-widest uppercase flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          THIẾU DEALER
          {slot0?.is_shortage && slot0.planned_relief_at ? (
            <span className="font-mono normal-case">· dự kiến {formatHHmm(slot0.planned_relief_at)}</span>
          ) : null}
        </div>
      )}

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xl font-bold text-foreground truncate">{table.table_name}</span>
          {table.tour_tier ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
              {table.tour_tier}
            </span>
          ) : null}
        </div>

        {/* BIG countdown */}
        <div className="flex items-baseline gap-3">
          <span className={["font-mono font-bold tabular-nums leading-none text-6xl", countdownColor].join(" ")}>
            {countdownLabel}
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-mono">
            {isOverdue ? "quá hạn" : "đến swing"}
          </span>
        </div>
        {table.swing_due_at && (
          <div className="text-xs text-muted-foreground font-mono">Swing lúc {formatHHmm(table.swing_due_at)}</div>
        )}

        {/* Current dealer */}
        {table.current_dealer ? (
          <div className="flex items-center gap-2 mt-1">
            <div className={["w-2.5 h-2.5 rounded-full", isOverdue ? "bg-destructive" : "bg-success"].join(" ")} />
            <span className="text-lg font-semibold text-foreground truncate">{table.current_dealer.full_name}</span>
            <Badge variant="outline" className={["text-xs font-bold", tierBadgeClass(table.current_dealer.tier)].join(" ")}>
              {table.current_dealer.tier ?? "?"}
            </Badge>
          </div>
        ) : (
          <div className="text-base text-muted-foreground mt-1">Bàn trống</div>
        )}

        {/* TIẾP THEO */}
        <div className="mt-auto pt-2 border-t border-border space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground uppercase tracking-widest">Tiếp theo</span>
            {slot0Locked && slot0?.in_attendance_id ? (
              <span className="text-base font-semibold text-success">
                ✓ CHỐT {slot0.in_dealer_name ?? "dealer"}
                {slot0.planned_relief_at ? (
                  <span className="ml-1.5 font-mono text-success/80">{formatHHmm(slot0.planned_relief_at)}</span>
                ) : null}
              </span>
            ) : slot0Predicted ? (
              <span className="text-base font-medium text-warning">
                ~ DỰ ĐOÁN {slot0!.in_dealer_name ?? "dealer"}
                {slot0!.planned_relief_at ? (
                  <span className="ml-1.5 font-mono text-warning/80">{formatHHmm(slot0!.planned_relief_at)}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-base font-semibold text-destructive">⚠ THIẾU DEALER</span>
            )}
          </div>
          {forecastSlots.length > 0 && (
            <div className="text-sm text-muted-foreground truncate">
              ~ Dự đoán:{" "}
              {forecastSlots
                .map((s) => `${s.in_dealer_name ?? "dealer"}${s.planned_relief_at ? ` ${formatHHmm(s.planned_relief_at)}` : ""}`)
                .join(" · ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Pool rail entry ─────────────────────────────────────────────────────── */

function PoolRow({ entry, nowMs }: { entry: BoardPoolEntry; nowMs: number }) {
  const releasedMs = entry.last_released_at ? new Date(entry.last_released_at).getTime() : null;
  const eligibleAtMs = releasedMs != null ? releasedMs + REST_MINUTES * 60_000 : null;
  const restRemainingSec = eligibleAtMs != null ? (eligibleAtMs - nowMs) / 1000 : null;
  const resting = restRemainingSec != null && restRemainingSec > 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card/60">
      <Badge variant="outline" className={["text-xs font-bold shrink-0", tierBadgeClass(entry.tier)].join(" ")}>
        {entry.tier ?? "?"}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-foreground truncate">{entry.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {STATE_LABELS[entry.current_state] ?? entry.current_state}
          {entry.prev_session_minutes != null ? ` · phiên trước ${Math.round(entry.prev_session_minutes)}p` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {resting ? (
          <>
            <div className="font-mono font-bold text-warning text-lg tabular-nums leading-none">
              {formatMmSs(restRemainingSec!)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">nghỉ giữa ca</div>
          </>
        ) : (
          <span className="text-sm font-semibold text-success">Sẵn sàng</span>
        )}
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function DealerControlBoard() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const nowMs = useLiveClock();

  const [clubs, setClubs] = useState<ClubRow[] | null>(null);
  const [clubFilter, setClubFilter] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { nav("/auth"); return; }
  }, [authLoading, user, nav]);

  // Load clubs the user can control dealers for (fallback to cashier clubs).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: dcIds } = await supabase.rpc("dealer_control_club_ids", { _user_id: user.id });
      let idArr = (dcIds ?? []).map((r: any) => (typeof r === "string" ? r : r.dealer_control_club_ids ?? r));
      if (!idArr.length) {
        const { data: cIds } = await supabase.rpc("cashier_club_ids", { _user_id: user.id });
        idArr = (cIds ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
      }
      if (!idArr.length) { setClubs([]); return; }
      const { data: cs } = await supabase.from("clubs").select("id,name").in("id", idArr);
      const rows = (cs ?? []) as ClubRow[];
      setClubs(rows);
      if (rows.length === 1) setClubFilter(rows[0].id);
    })();
  }, [user]);

  const clubIds = useMemo(() => {
    if (!clubs) return [];
    return clubFilter ? [clubFilter] : clubs.map((c) => c.id);
  }, [clubs, clubFilter]);

  const { board, loading, error } = useRotationBoard(clubIds);

  const sortedTables = useMemo(() => {
    const tables = [...(board?.tables ?? [])];
    // soonest relief / most overdue first
    tables.sort((a, b) => {
      const da = a.swing_due_at ? new Date(a.swing_due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.swing_due_at ? new Date(b.swing_due_at).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });
    return tables;
  }, [board?.tables]);

  const sortedPool = useMemo(() => {
    const pool = [...(board?.pool ?? [])];
    pool.sort((a, b) => (a.prev_session_minutes ?? 0) - (b.prev_session_minutes ?? 0));
    return pool;
  }, [board?.pool]);

  if (authLoading || !user || clubs === null) {
    return (
      <div className="min-h-screen bg-card p-6">
        <Skeleton className="h-screen rounded-xl" />
      </div>
    );
  }

  if (clubs.length === 0) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-xl font-bold text-foreground">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">Liên hệ Super Admin để được gán quyền điều phối dealer.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-card text-foreground p-4 lg:p-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <MonitorPlay className="w-6 h-6 text-primary" />
          <h1 className="text-xl lg:text-2xl font-bold tracking-wide uppercase">Bảng điều phối Dealer</h1>
        </div>
        <div className="font-mono text-2xl lg:text-3xl font-bold tabular-nums text-foreground ml-2">
          {new Date(nowMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error && (
            <Badge variant="outline" className="border-destructive/50 text-destructive text-xs">
              Lỗi tải dữ liệu — đang thử lại
            </Badge>
          )}
          {/* Radix Select forbids value="" — sentinel "all" */}
          <Select value={clubFilter ?? "all"} onValueChange={(v) => setClubFilter(v === "all" ? null : v)}>
            <SelectTrigger className="w-[220px] bg-card border-border text-foreground">
              <SelectValue placeholder="Chọn CLB" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả CLB</SelectItem>
              {clubs.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Table grid */}
        <div className="col-span-12 xl:col-span-9">
          {loading && !board ? (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-xl bg-card" />
              ))}
            </div>
          ) : sortedTables.length === 0 ? (
            <div className="border border-border rounded-xl py-24 text-center text-muted-foreground text-lg">
              Không có bàn đang hoạt động
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {sortedTables.map((t) => (
                <BoardTableCard key={t.table_id} table={t} nowMs={nowMs} />
              ))}
            </div>
          )}
        </div>

        {/* Pool rail */}
        <div className="col-span-12 xl:col-span-3">
          <div className="rounded-xl border border-border bg-card/40 p-3 xl:sticky xl:top-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold uppercase tracking-widest text-foreground">Pool dealer</span>
              <Badge variant="outline" className="ml-auto text-xs border-border text-muted-foreground">
                {sortedPool.length}
              </Badge>
            </div>
            {loading && !board ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg bg-card" />
                ))}
              </div>
            ) : sortedPool.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-10">Không có dealer trong pool</div>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-160px)] overflow-y-auto pr-1">
                {sortedPool.map((p) => (
                  <PoolRow key={p.attendance_id} entry={p} nowMs={nowMs} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
