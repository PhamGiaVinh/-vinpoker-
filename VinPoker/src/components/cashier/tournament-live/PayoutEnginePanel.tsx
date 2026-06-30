import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Calculator, Loader2, Lock, Save, Pencil, AlertTriangle, RefreshCw, Plus, Trash2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";

// PR-3: flag-gated (FEATURES.payoutEngine) operator UI for the "Engine 3-neo" payout backend
// (PR-2a RPCs + PR-2b compute-payouts Edge). Forecast preview (no persist) · one-way close-and-
// generate official · guarded manual edit. Renders ONLY when payoutEngine is ON; otherwise the
// old PrizeStructurePanel is shown unchanged (see PrizesTab).

type Archetype = "DAILY" | "INTL" | "MULTI" | "TRITON" | "CUSTOM" | "LIVE_STANDARD";
const ARCHE_LABEL: Record<Archetype, string> = { DAILY: "DAILY (top nặng · 2×)", INTL: "INTL (phẳng · 2×)", MULTI: "MULTI (phẳng · 1.5×)", TRITON: "TRITON (tham khảo)", CUSTOM: "CUSTOM — CLB tự cấu hình", LIVE_STANDARD: "LIVE STANDARD (final table riêng · ngoài FT theo nhóm)" };
const DEFAULT_MINCASH: Record<Archetype, number> = { DAILY: 2, INTL: 2, MULTI: 1.5, TRITON: 1.6, CUSTOM: 2, LIVE_STANDARD: 2 };

interface PayoutRow { position: number; amount: number; percentage: number; }
interface EngineResult { rows: PayoutRow[]; itmPlaces: number; effectiveFloor: number; prizePool?: number; archetype: Archetype; warnings: string[]; }

const ERR_VI: Record<string, string> = {
  REGISTRATION_CLOSED: "Đăng ký đã đóng — không thể tạo entry mới.",
  REGISTRATION_NOT_CLOSED: "Chưa đóng đăng ký — không thể chốt payout.",
  SUM_MISMATCH: "Tổng tiền không khớp prize pool đã chốt.",
  RUN_NOT_DRAFT: "Bản payout này đã được áp dụng — không chạy lại được.",
  RUN_NOT_FOUND: "Không tìm thấy bản nháp payout.",
  NOT_AUTHORIZED: "Bạn không có quyền (cần Owner/Admin/Cashier của CLB).",
  MANUAL_EDIT_REASON_REQUIRED: "Cần nhập lý do khi chỉnh tay.",
  PRIZE_POOL_OVERRIDE_REASON_REQUIRED: "Cần lý do khi sửa prize pool.",
  MULTIDAY_UNSUPPORTED: "Giải nhiều ngày chưa hỗ trợ payout tự động.",
  CUSTOM_SCHEMA_NOT_READY: "Chế độ CUSTOM chưa sẵn sàng (DB chưa được cập nhật).",
  NO_PAID_ENTRIES: "Chưa có entry đã trả tiền.",
  NO_APPLIED_RUN: "Chưa có payout chính thức để chỉnh tay.",
  PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT: "Một suất vượt giới hạn lưu trữ (>10 tỉ).",
  POOL_BELOW_MIN_CASH: "Pool nhỏ hơn min-cash — chỉ trả 1 suất.",
  NOT_MONOTONE: "Bảng payout phải giảm dần theo hạng.",
  POSITION_GAP_OR_DUP: "Hạng phải liên tục 1..N, không trùng/thiếu.",
};
function friendly(msg?: string): string {
  if (!msg) return "Lỗi không xác định";
  for (const k of Object.keys(ERR_VI)) if (msg.includes(k)) return `${ERR_VI[k]} (${k})`;
  return msg;
}
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

interface TournamentRow {
  id: string; buy_in: number; rake_amount: number | null; prize_pool: number | null; itm_places: number | null;
  registration_closed_at: string | null; live_status: string | null; event_id: string | null; club_id: string;
}

export function PayoutEnginePanel({ tournamentId }: { tournamentId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tour, setTour] = useState<TournamentRow | null>(null);
  const [officialRows, setOfficialRows] = useState<PayoutRow[]>([]);
  const [appliedRun, setAppliedRun] = useState<any | null>(null);
  const [liveEntries, setLiveEntries] = useState<number>(0);

  // generator inputs
  const [entries, setEntries] = useState<number>(0);
  const [itmPct, setItmPct] = useState<number>(15); // percent in the UI; sent as /100
  const [archetype, setArchetype] = useState<Archetype>("DAILY");
  const [minCashX, setMinCashX] = useState<number>(2);
  const [roundingUnit, setRoundingUnit] = useState<number>(100000);
  const [poolOverride, setPoolOverride] = useState<string>(""); // empty = auto
  const [overrideReason, setOverrideReason] = useState<string>("");
  // CUSTOM mode (gated by FEATURES.payoutCustomMode): club enters its own % per rank.
  const customMode = FEATURES.payoutCustomMode;
  const bandedMode = FEATURES.payoutBandedMode;
  const [customRows, setCustomRows] = useState<{ position: number; percent: number }[]>([
    { position: 1, percent: 50 }, { position: 2, percent: 30 }, { position: 3, percent: 20 },
  ]);

  const [preview, setPreview] = useState<EngineResult | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "official">("");

  // manual edit
  const [editing, setEditing] = useState(false);
  const [editRows, setEditRows] = useState<PayoutRow[]>([]);
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const isClosed = !!tour?.registration_closed_at || tour?.live_status === "finished";
  const hasOfficial = officialRows.length > 0;
  const isMultiDay = !!tour?.event_id;
  const editedManually = appliedRun?.source === "manual_edit";
  const isCustom = archetype === "CUSTOM";

  const customBp = useCallback(
    () => customRows.map((r, i) => ({ position: i + 1, percent_bp: Math.round((Number(r.percent) || 0) * 100) })),
    [customRows],
  );
  const customBpTotal = useMemo(() => customBp().reduce((s, r) => s + r.percent_bp, 0), [customBp]);
  const customValid = useMemo(() => {
    const bp = customBp();
    if (bp.length < 1) return false;
    for (let i = 0; i < bp.length; i++) {
      if (!(bp[i].percent_bp > 0)) return false;
      if (i > 0 && bp[i].percent_bp > bp[i - 1].percent_bp) return false;
    }
    return customBpTotal === 10000;
  }, [customBp, customBpTotal]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [{ data: t, error: te }, prizesRes, runRes, cntRes] = await Promise.all([
        // (supabase as any): registration_closed_at + planned_* are live (PR-2a) but not in the
        // generated types.ts (no regen) — treat tournaments as any here, same as the rows/entries reads.
        (supabase as any).from("tournaments").select("id, buy_in, rake_amount, prize_pool, itm_places, registration_closed_at, live_status, event_id, club_id").eq("id", tournamentId).single(),
        (supabase.rpc as any)("get_tournament_prizes", { p_tournament_id: tournamentId }),
        (supabase as any).from("tournament_payout_runs").select("*").eq("tournament_id", tournamentId).eq("status", "applied").maybeSingle(),
        (supabase as any).from("tournament_entries").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId).neq("status", "cancelled"),
      ]);
      if (te) throw te;
      setTour(t as TournamentRow);
      const prizes = ((prizesRes?.data ?? []) as any[]).map((p) => ({ position: Number(p.position), amount: Number(p.amount), percentage: Number(p.percentage) }));
      setOfficialRows(prizes);
      setAppliedRun(runRes?.data ?? null);
      const cnt = Number(cntRes?.count ?? 0);
      setLiveEntries(cnt);
      setEntries((prev) => (prev > 0 ? prev : cnt));
      setRoundingUnit((t as TournamentRow).buy_in < 2_000_000 ? 100_000 : 1_000_000);
    } catch (e: any) {
      setLoadError(e?.message || "Không tải được dữ liệu payout");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setMinCashX(DEFAULT_MINCASH[archetype]); }, [archetype]);

  const defaultPool = useMemo(() => entries * (tour?.buy_in ?? 0), [entries, tour]);

  function reqBody() {
    const body: Record<string, unknown> = {
      mode: "preview", tournament_id: tournamentId, archetype,
      min_cash_x: minCashX, rounding_unit: roundingUnit, entries_override: entries,
    };
    if (isCustom) body.custom_percents = customBp();
    else body.itm_percent = itmPct / 100;
    const ov = poolOverride.trim() ? Number(poolOverride) : null;
    if (ov != null && ov !== defaultPool) body.prize_pool_override = ov;
    return body;
  }

  const runPreview = useCallback(async () => {
    if (!(entries > 0)) { toast.error("Nhập số entry > 0 để xem trước"); return; }
    if (isCustom && !customValid) { toast.error("Cấu hình % chưa hợp lệ — Σ phải = 100%, giảm dần, mỗi hạng > 0"); return; }
    setBusy("preview");
    try {
      const { data, error } = await supabase.functions.invoke("compute-payouts", { body: reqBody() });
      const res = data as any;
      if (error || res?.error) { toast.error(friendly(res?.error || error?.message)); return; }
      setPreview({ rows: res.result.rows, itmPlaces: res.result.itmPlaces, effectiveFloor: res.result.effectiveFloor, prizePool: res.prizePool, archetype: res.result.archetype, warnings: res.result.warnings ?? [] });
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setBusy(""); }
  }, [entries, itmPct, archetype, minCashX, roundingUnit, poolOverride, defaultPool, tournamentId, isCustom, customValid, customBp]);

  // Official: close registration (one-way) via prepare_payout_snapshot, then compute-payouts official.
  const runOfficial = useCallback(async () => {
    if (isCustom && !customValid) { toast.error("Cấu hình % chưa hợp lệ — Σ phải = 100%, giảm dần, mỗi hạng > 0"); return; }
    setBusy("official");
    try {
      const ov = poolOverride.trim() ? Number(poolOverride) : null;
      const prep = await (supabase.rpc as any)("prepare_payout_snapshot", {
        p_tournament_id: tournamentId, p_itm_percent: itmPct / 100, p_archetype: archetype,
        p_min_cash_x: minCashX, p_rounding_unit: roundingUnit,
        p_prize_pool_override: ov != null && ov !== defaultPool ? ov : null,
        p_override_reason: overrideReason.trim() || null, p_regenerate: false, p_reason: null,
        p_custom_percents: isCustom ? customBp() : null,
      });
      if (prep.error) { toast.error(friendly(prep.error.message)); return; }
      const runId = (prep.data as any)?.run_id;
      if (!runId) { toast.error("Không tạo được snapshot payout"); return; }
      const { data, error } = await supabase.functions.invoke("compute-payouts", { body: { mode: "official", run_id: runId } });
      const res = data as any;
      if (error || res?.error) { toast.error(friendly(res?.error || error?.message)); return; }
      toast.success("Đã đóng đăng ký & tạo payout chính thức");
      setPreview(null);
      await load();
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setBusy(""); }
  }, [tournamentId, itmPct, archetype, minCashX, roundingUnit, poolOverride, overrideReason, defaultPool, load, isCustom, customValid, customBp]);

  const startEdit = () => { setEditRows(officialRows.map((r) => ({ ...r }))); setEditReason(""); setEditing(true); };
  const editSum = useMemo(() => editRows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [editRows]);
  const lockedPool = Number(appliedRun?.prize_pool_snapshot ?? tour?.prize_pool ?? 0);

  const saveEdit = useCallback(async () => {
    if (!editReason.trim()) { toast.error(friendly("MANUAL_EDIT_REASON_REQUIRED")); return; }
    setSavingEdit(true);
    try {
      const rows = editRows.map((r) => ({ position: r.position, amount: Math.round(Number(r.amount) || 0) }));
      const { error } = await (supabase.rpc as any)("save_tournament_prizes_v2", { p_tournament_id: tournamentId, p_rows: rows, p_reason: editReason.trim() });
      if (error) { toast.error(friendly(error.message)); return; }
      toast.success("Đã lưu chỉnh tay (đã ghi audit)");
      setEditing(false);
      await load();
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setSavingEdit(false); }
  }, [editRows, editReason, tournamentId, load]);

  // ---------- render ----------
  if (loading) return <Card className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></Card>;
  if (loadError) return (
    <Card className="p-6 space-y-3 text-center">
      <p className="text-sm text-destructive">{loadError}</p>
      <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại</Button>
    </Card>
  );

  const RowsTable = ({ rows, pool }: { rows: PayoutRow[]; pool: number }) => (
    <div className="max-h-[44vh] overflow-y-auto rounded border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-secondary text-muted-foreground"><tr>
          <th className="text-left px-3 py-1.5 font-medium">Hạng</th>
          <th className="text-right px-3 py-1.5 font-medium">Tiền thưởng</th>
          <th className="text-right px-3 py-1.5 font-medium">%</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.position} className="border-t border-border/60">
              <td className="px-3 py-1.5">{r.position}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">{vnd(r.amount)}</td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">{r.percentage.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-border bg-secondary/50">
          <td className="px-3 py-1.5 font-medium">Σ ({rows.length} suất)</td>
          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-primary">{vnd(rows.reduce((s, r) => s + r.amount, 0))}</td>
          <td className="px-3 py-1.5 text-right text-muted-foreground">/ {vnd(pool)}</td>
        </tr></tfoot>
      </table>
    </div>
  );

  return (
    <Card className="p-4 space-y-4">
      {/* header + state badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-primary" />
          <span className="font-semibold">Cơ cấu giải thưởng <span className="text-muted-foreground font-normal">· Engine 3-neo</span></span>
        </div>
        {hasOfficial
          ? <Badge className="bg-primary/15 text-primary border-primary/30">PAYOUT CHÍNH THỨC{editedManually ? " · Đã chỉnh tay" : ""}</Badge>
          : isClosed
            ? <Badge className="bg-warning/15 text-warning border-warning/30">Đã đóng đăng ký — chưa tạo payout</Badge>
            : <Badge variant="outline" className="text-muted-foreground">Đăng ký đang mở</Badge>}
      </div>

      {isMultiDay && (
        <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Giải nhiều ngày (multi-day) chưa hỗ trợ payout tự động. Hãy chốt thủ công cho từng flight/Main Event.</span>
        </div>
      )}

      {/* ===== generator / preview inputs ===== */}
      <div className="space-y-3 rounded border border-border p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Số entry {isClosed ? "" : "(dự kiến)"}</Label>
            <Input type="number" value={entries} onChange={(e) => setEntries(Number(e.target.value))} />
            <p className="text-[11px] text-muted-foreground">đang có {liveEntries} (đã trả tiền)</p>
          </div>
          {!isCustom && (
            <div className="space-y-1">
              <Label className="text-xs">ITM %</Label>
              <Input type="number" step="0.5" value={itmPct} onChange={(e) => setItmPct(Number(e.target.value))} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Kiểu giải</Label>
            <Select value={archetype} onValueChange={(v) => setArchetype(v as Archetype)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["DAILY", "MULTI", "INTL", ...(bandedMode ? ["LIVE_STANDARD"] : []), ...(customMode ? ["CUSTOM"] : [])] as Archetype[]).map((a) => <SelectItem key={a} value={a}>{ARCHE_LABEL[a]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Min-cash ×</Label>
            <Input type="number" step="0.5" value={minCashX} onChange={(e) => setMinCashX(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Làm tròn (đ)</Label>
            <Input type="number" step="100000" value={roundingUnit} onChange={(e) => setRoundingUnit(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prize pool (sửa tay)</Label>
            <Input type="number" placeholder={`auto = ${vnd(defaultPool)}`} value={poolOverride} onChange={(e) => setPoolOverride(e.target.value)} />
          </div>
        </div>
        {isCustom && (
          <div className="space-y-2 rounded border border-primary/30 bg-primary/5 p-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Cơ cấu % tự cấu hình (giảm dần · Σ = 100%)</Label>
              <span className={`text-xs font-mono ${customBpTotal === 10000 ? "text-primary" : "text-destructive"}`}>
                Σ {(customBpTotal / 100).toFixed(2)}% {customBpTotal === 10000 ? "✓" : "✗ phải = 100%"}
              </span>
            </div>
            <div className="max-h-[34vh] overflow-y-auto space-y-1 pr-1">
              {customRows.map((r, i) => {
                const pool = poolOverride.trim() && Number(poolOverride) !== defaultPool ? Number(poolOverride) : defaultPool;
                const amt = Math.round((pool * Math.round((Number(r.percent) || 0) * 100)) / 10000);
                return (
                  <div key={i} className="grid grid-cols-[2.5rem_1fr_7rem_2rem] gap-2 items-center">
                    <span className="text-xs text-muted-foreground text-right">#{i + 1}</span>
                    <Input type="number" step="0.5" value={r.percent} aria-label={`percent rank ${i + 1}`}
                      onChange={(e) => setCustomRows((prev) => prev.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} />
                    <span className="text-xs font-mono tabular-nums text-muted-foreground text-right">{vnd(amt)}đ</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={customRows.length <= 1} aria-label={`remove rank ${i + 1}`}
                      onClick={() => setCustomRows((prev) => prev.filter((_, j) => j !== i).map((x, j) => ({ ...x, position: j + 1 })))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button size="sm" variant="outline" onClick={() => setCustomRows((prev) => [...prev, { position: prev.length + 1, percent: 0 }])}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Thêm hạng
            </Button>
          </div>
        )}
        {poolOverride.trim() && Number(poolOverride) !== defaultPool && (
          <Input placeholder="Lý do sửa prize pool (bắt buộc)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy !== "" || isMultiDay || (isCustom && !customValid)}>
            {busy === "preview" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1" />} Xem trước (Dự kiến)
          </Button>

          {/* official / close-and-generate */}
          {!hasOfficial && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="gap-1" disabled={busy !== "" || isMultiDay || !(entries > 0) || (isCustom && !customValid)}>
                  <Lock className="w-3.5 h-3.5" /> {isClosed ? "Tạo payout chính thức" : "Đóng đăng ký & tạo payout"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4 text-warning" /> {isClosed ? "Tạo payout chính thức?" : "Đóng đăng ký & chốt payout?"}</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    {!isClosed && <span className="block font-medium text-warning">⚠️ Đóng đăng ký là MỘT CHIỀU — không mở lại được.</span>}
                    <span className="block">Hệ thống sẽ chốt {entries} entry (snapshot), prize pool {vnd(poolOverride.trim() && Number(poolOverride) !== defaultPool ? Number(poolOverride) : defaultPool)}đ, rồi tạo bảng payout chính thức ({isCustom ? `CUSTOM · ${customRows.length} suất` : `${archetype}, ITM ${itmPct}%`}). Sau đó vẫn chỉnh tay được (có ghi audit).</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction onClick={runOfficial}>{isClosed ? "Tạo payout" : "Đóng đăng ký & tạo"}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ===== preview result (estimated, no persist) ===== */}
      {preview && !hasOfficial && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="w-3.5 h-3.5" /> <span>DỰ KIẾN{isCustom ? " — custom" : ""} — chưa đóng đăng ký, chưa lưu. Số liệu thay đổi theo entry.</span>
          </div>
          {isCustom && preview.rows.length > 0 && (() => {
            const floor = minCashX * ((tour?.buy_in ?? 0) + (tour?.rake_amount ?? 0));
            const last = preview.rows[preview.rows.length - 1].amount;
            return last < floor ? (
              <p className="text-[11px] text-warning">Lưu ý: hạng cuối ({vnd(last)}đ) thấp hơn min-cash tham khảo ({vnd(floor)}đ). CUSTOM bỏ qua sàn min-cash — vẫn cho phép.</p>
            ) : null;
          })()}
          {preview.warnings.length > 0 && <p className="text-[11px] text-muted-foreground">Cảnh báo: {preview.warnings.join(", ")}</p>}
          <RowsTable rows={preview.rows} pool={preview.prizePool ?? defaultPool} />
        </div>
      )}

      {/* ===== official table + manual edit ===== */}
      {hasOfficial && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Chốt: {appliedRun?.entries_snapshot ?? tour?.itm_places} entry · pool {vnd(lockedPool)}đ · {appliedRun?.itm_places ?? officialRows.length} suất
            </p>
            {!editing && <Button size="sm" variant="outline" onClick={startEdit}><Pencil className="w-3.5 h-3.5 mr-1" /> Chỉnh tay</Button>}
          </div>

          {!editing ? (
            <RowsTable rows={officialRows} pool={lockedPool} />
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Chỉnh tay được GHI AUDIT. Tổng phải = prize pool đã chốt ({vnd(lockedPool)}đ), giảm dần theo hạng.</span>
              </div>
              <div className="max-h-[40vh] overflow-y-auto space-y-1 pr-1">
                {editRows.map((r, i) => (
                  <div key={r.position} className="grid grid-cols-[3rem_1fr] gap-2 items-center">
                    <span className="text-xs text-muted-foreground text-right">#{r.position}</span>
                    <Input type="number" value={r.amount} onChange={(e) => setEditRows((prev) => prev.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                  </div>
                ))}
              </div>
              <div className={`text-xs ${editSum === lockedPool ? "text-primary" : "text-destructive"}`}>
                Σ = {vnd(editSum)}đ {editSum === lockedPool ? "✓ khớp pool" : `✗ phải = ${vnd(lockedPool)}đ`}
              </div>
              <Textarea placeholder="Lý do chỉnh tay (bắt buộc — ghi audit)" value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveEdit} disabled={savingEdit || !editReason.trim() || editSum !== lockedPool}>
                  {savingEdit ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />} Lưu chỉnh tay
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Hủy</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
