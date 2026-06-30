import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { supabase } from "@/integrations/supabase/client";

// The CAPTURE v0 tables are NOT in the generated Database types yet (the migration is source-only;
// types.ts is regenerated only AFTER the owner applies it). Cast the client until then.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdb = supabase as any;

const HORIZONS = ["T-21", "T-7", "T-1", "T-0", "post"] as const;

interface DecisionLogRow {
  id: string;
  event_id: string;
  decision_horizon: string;
  recommended_action: string | null;
  owner_decision: string | null;
  public_action: string | null;
  decision_reason: string | null;
  created_at: string;
}

const EMPTY = { event_id: "", decision_horizon: "T-7", recommended_action: "", owner_decision: "", public_action: "", decision_reason: "" };

/**
 * Series Intelligence — CAPTURE v0 Decision Log admin (skeleton). DATA CAPTURE ONLY — no model, no
 * prediction. Flag- + role-gated (redirects home when off / unauthorized). Reads + writes
 * `series_decision_logs` directly (owner-scoped RLS). Requires the source-only migration to be applied live.
 */
export default function SeriesDecisionLogAdmin() {
  const nav = useNavigate();
  const { isAdmin, isClubAdmin, isClubOwner, loading } = useAuth();
  const [clubId, setClubId] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [rows, setRows] = useState<DecisionLogRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Read only when allowed — flag OFF or unauthorized ⇒ NO DB call fires at all.
  const canRead = !loading && FEATURES.seriesDecisionLog && (isClubAdmin || isClubOwner || isAdmin);
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await sdb
        .from("series_decision_logs")
        .select("id,event_id,decision_horizon,recommended_action,owner_decision,public_action,decision_reason,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        setLoadError(error.message ?? "Không đọc được");
        setRows([]);
      } else {
        setLoadError(null);
        setRows((data ?? []) as DecisionLogRow[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canRead, reloadKey]);

  if (loading) return null;
  if (!FEATURES.seriesDecisionLog) return <Navigate to="/" replace />;
  if (!(isClubAdmin || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  const setField = (k: keyof typeof EMPTY, v: string): void => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (): Promise<void> => {
    if (!clubId.trim() || !form.event_id.trim()) {
      toast.error("Cần club_id và event_id");
      return;
    }
    setBusy(true);
    const { error } = await sdb.from("series_decision_logs").insert({ club_id: clubId.trim(), ...form });
    setBusy(false);
    if (error) {
      toast.error("Lưu lỗi: " + (error.message ?? "unknown"));
      return;
    }
    toast.success("Đã lưu decision log");
    setForm((f) => ({ ...f, recommended_action: "", owner_decision: "", public_action: "", decision_reason: "" }));
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="container max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Quay lại">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-display text-2xl text-primary flex items-center gap-2">
            <ClipboardList className="w-5 h-5" /> Decision Log (CAPTURE v0)
          </h1>
          <p className="text-xs text-muted-foreground">Ghi quyết định vận hành series. Đây là tầng GHI DỮ LIỆU — không có model, không dự đoán.</p>
        </div>
      </div>

      <Card className="p-3 border-primary/40 bg-primary/5 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0" />
        <span>Cần migration <code className="font-mono">20261125000000_series_capture_v0</code> đã apply live thì mới ghi/đọc được. Nhập <strong>club_id</strong> của bạn + <strong>event_id</strong> (tournament) — RLS chỉ cho ghi vào club bạn sở hữu.</span>
      </Card>

      {/* write form */}
      <Card className="p-3 border-primary/30 space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <Field label="club_id (UUID)"><Input className="h-8 font-mono" value={clubId} onChange={(e) => setClubId(e.target.value)} placeholder="club bạn sở hữu" /></Field>
          <Field label="event_id (tournament UUID)"><Input className="h-8 font-mono" value={form.event_id} onChange={(e) => setField("event_id", e.target.value)} /></Field>
          <Field label="Mốc quyết định">
            <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={form.decision_horizon} onChange={(e) => setField("decision_horizon", e.target.value)}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </Field>
          <Field label="Đề xuất (recommended)"><Input className="h-8" value={form.recommended_action} onChange={(e) => setField("recommended_action", e.target.value)} /></Field>
          <Field label="Quyết định của chủ"><Input className="h-8" value={form.owner_decision} onChange={(e) => setField("owner_decision", e.target.value)} /></Field>
          <Field label="Hành động công khai"><Input className="h-8" value={form.public_action} onChange={(e) => setField("public_action", e.target.value)} /></Field>
        </div>
        <Field label="Lý do"><Input className="h-8" value={form.decision_reason} onChange={(e) => setField("decision_reason", e.target.value)} /></Field>
        <Button size="sm" className="gap-1.5" onClick={submit} disabled={busy}>
          <ClipboardList className="h-4 w-4" /> {busy ? "Đang lưu…" : "Lưu decision log"}
        </Button>
      </Card>

      {/* recent logs */}
      <Card className="p-3 border-border/60 space-y-2 text-xs">
        <div className="font-medium">Decision log gần đây</div>
        {loadError ? (
          <p className="text-[11px] text-warning">Chưa đọc được (bảng có thể chưa apply): {loadError}</p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Chưa có bản ghi.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.id} className="border-t border-border/40 pt-1">
                <div className="flex flex-wrap gap-x-2 text-[11px]">
                  <span className="rounded border border-border px-1 text-[9px]">{r.decision_horizon}</span>
                  <span className="font-mono text-muted-foreground">{r.event_id.slice(0, 8)}…</span>
                  {r.owner_decision && <span>QĐ: {r.owner_decision}</span>}
                  {r.public_action && <span className="text-muted-foreground">· {r.public_action}</span>}
                </div>
                {r.decision_reason && <div className="text-[10px] text-muted-foreground">{r.decision_reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {children}
    </label>
  );
}
