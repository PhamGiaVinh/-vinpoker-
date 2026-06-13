import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Save, Plus, Trash2, Coffee, Lock } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";

interface LevelRow {
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

const SAVE_LIVE = FEATURES.blindEditorSave;

/**
 * Floor blind-structure editor. Reads tournament_levels, lets the floor add /
 * edit / delete levels, and full-replaces via the source-only
 * update_blind_structure RPC. Production-safe: while the RPC is not live
 * (FEATURES.blindEditorSave === false) the editor is a draft-local preview —
 * Save is disabled with "Cần bật RPC" and NEVER calls the RPC (no silent fail,
 * no wipe). The running clock (ClockPanel) only READS this structure.
 */
export function BlindEditorPanel({
  tournamentId,
  tournamentStatus,
}: {
  tournamentId: string;
  tournamentStatus?: string;
}) {
  const [rows, setRows] = useState<LevelRow[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setInitialLoading(true);
    try {
      const [levelsRes, tourRes] = await Promise.all([
        supabase
          .from("tournament_levels")
          .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
          .eq("tournament_id", tournamentId)
          .order("level_number"),
        supabase.from("tournaments").select("current_level").eq("id", tournamentId).single(),
      ]);
      if (levelsRes.error) { toast.error("Không tải được cấu trúc blind: " + levelsRes.error.message); return; }
      setRows((levelsRes.data ?? []).map((r: any) => ({
        small_blind: Number(r.small_blind) || 0,
        big_blind: Number(r.big_blind) || 0,
        ante: Number(r.ante) || 0,
        duration_minutes: Number(r.duration_minutes) || 0,
        is_break: !!r.is_break,
      })));
      setCurrentLevel((tourRes.data as any)?.current_level ?? null);
    } finally {
      setInitialLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const update = (i: number, field: keyof LevelRow, value: number | boolean) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const addLevel = () =>
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, last
        ? { ...last, is_break: false, small_blind: last.small_blind * 2, big_blind: last.big_blind * 2, ante: last.ante * 2 }
        : { small_blind: 100, big_blind: 200, ante: 0, duration_minutes: 20, is_break: false }];
    });

  const addBreak = () =>
    setRows((prev) => [...prev, { small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 15, is_break: true }]);

  const removeLevel = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const validate = (): string | null => {
    if (rows.length === 0) return "Chưa có level nào.";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if ([r.small_blind, r.big_blind, r.ante, r.duration_minutes].some((v) => !Number.isFinite(v) || v < 0))
        return `Level ${i + 1}: giá trị không hợp lệ (không được âm).`;
      if (!r.is_break && r.big_blind <= 0) return `Level ${i + 1}: BB phải > 0.`;
    }
    return null;
  };

  const save = async () => {
    if (!SAVE_LIVE) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    const isLive = tournamentStatus === "live" || tournamentStatus === "active" || tournamentStatus === "break";
    if (isLive && !window.confirm("Giải đang chạy — thay toàn bộ cấu trúc blind? Đồng hồ sẽ đọc cấu trúc mới.")) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("update_blind_structure", {
        p_tournament_id: tournamentId,
        p_levels: rows.map((r, i) => ({ level_number: i + 1, ...r })),
      });
      if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
      toast.success(`Đã lưu ${rows.length} level`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">Cấu trúc blind</div>
          <p className="text-xs text-muted-foreground">
            Floor đặt cấu trúc; đồng hồ chỉ đọc &amp; chạy theo cấu trúc này.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addBreak} disabled={initialLoading}>
            <Coffee className="w-3.5 h-3.5 mr-1" /> Break
          </Button>
          <Button size="sm" variant="outline" onClick={addLevel} disabled={initialLoading}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Level
          </Button>
          {SAVE_LIVE ? (
            <Button size="sm" onClick={save} disabled={saving || initialLoading}>
              <Save className="w-3.5 h-3.5 mr-1" /> Lưu
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled title="Cần apply RPC update_blind_structure">
              <Lock className="w-3.5 h-3.5 mr-1" /> Cần bật RPC
            </Button>
          )}
        </div>
      </div>

      {!SAVE_LIVE && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Chế độ xem/nháp: RPC <code>update_blind_structure</code> chưa được bật trên production —
          sửa được nhưng chưa lưu được. Bật sau khi apply RPC trong phiên DB có kiểm soát.
        </div>
      )}

      {initialLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Chưa có cấu trúc blind. Thêm Level để bắt đầu.</div>
      ) : (
        <div className="space-y-1.5">
          <div className="hidden sm:grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_auto] gap-2 px-2 text-xs text-muted-foreground">
            <span>Lv</span><span>SB</span><span>BB</span><span>Ante</span><span>Phút</span><span />
          </div>
          {rows.map((r, i) => {
            const isCurrent = currentLevel === i + 1;
            return (
              <div
                key={i}
                className={`grid grid-cols-2 gap-2 items-end rounded border p-2 sm:grid-cols-[2.5rem_1fr_1fr_1fr_1fr_auto] sm:items-center ${isCurrent ? "border-primary/50 bg-primary/5" : "border-border"}`}
              >
                <div className={`text-sm font-semibold tabular-nums ${isCurrent ? "text-primary" : ""}`}>
                  {isCurrent ? "▸ " : ""}{i + 1}
                </div>
                {r.is_break ? (
                  <div className="col-span-1 sm:col-span-4 flex items-center gap-2 text-sm text-amber-400">
                    <Coffee className="w-4 h-4" /> Break
                  </div>
                ) : (
                  <>
                    <LabeledInput label="SB" value={r.small_blind} onChange={(v) => update(i, "small_blind", v)} />
                    <LabeledInput label="BB" value={r.big_blind} onChange={(v) => update(i, "big_blind", v)} />
                    <LabeledInput label="Ante" value={r.ante} onChange={(v) => update(i, "ante", v)} />
                  </>
                )}
                <LabeledInput label="Phút" value={r.duration_minutes} onChange={(v) => update(i, "duration_minutes", v)} />
                <Button size="sm" variant="ghost" className="h-11 justify-self-end text-destructive" onClick={() => removeLevel(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-0.5">
      <label className="text-[11px] text-muted-foreground sm:hidden">{label}</label>
      <Input className="h-11" type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
