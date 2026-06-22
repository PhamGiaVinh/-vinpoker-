import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Save, ChevronDown, ChevronRight, CalendarPlus, Loader2, ListOrdered, Play, History } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { FomoPrice } from "@/components/FomoPrice";
import { LiveStateEditor } from "@/components/LiveStateEditor";
import { BlindEditorPanel } from "@/components/cashier/tournament-live/BlindEditorPanel";
import { formatDateTime, formatVND } from "@/lib/format";
import { BLIND_PRESETS, type BlindLevel, type BlindTemplate } from "@/lib/blindPresets";
import { useAuth } from "@/hooks/useAuth";

const GAME_TYPES = [
  { v: "nlh", l: "No Limit Hold'em" },
  { v: "plo", l: "Pot Limit Omaha" },
  { v: "mixed", l: "Mixed Games" },
];

type ClubRow = { id: string; name: string };

/**
 * Floor — tournament list management (create / edit / delete / status / live-state).
 * Moved from Club Admin so the floor owns the tournament list it operates on.
 * Frontend-only: plain `tournaments` table CRUD, no money/finance side effects beyond
 * the rake / service-fee fields the create/edit dialogs already wrote in Club Admin.
 * Scoped to the operator's clubs; multi-club picks the target club on create.
 */
export function TournamentManagerPanel({ clubIds, clubs, embedded = false }: { clubIds: string[]; clubs: ClubRow[]; embedded?: boolean }) {
  const { t } = useTranslation();
  const [tours, setTours] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const clubNameMap = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const multiClub = clubs.length > 1;

  const load = useCallback(async () => {
    if (!clubIds.length) {
      setTours([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .in("club_id", clubIds)
      .order("start_time");
    if (error) toast.error(error.message);
    setTours(data ?? []);
    setLoading(false);
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  // Auto-update the floor list when tournaments change anywhere (e.g. super-admin
  // bulk-creates from a schedule image) — load() re-filters to this floor's clubs,
  // so a new tournament for one of these clubs appears without a manual refresh.
  // Keyed on the club-id string (not the array ref) to avoid resubscribe churn.
  const loadRef = useRef(load);
  loadRef.current = load;
  const clubKey = clubIds.join(",");
  useEffect(() => {
    if (!clubKey) return;
    const channel = supabase
      .channel(`floor-tour-mgr:${clubKey}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => {
        loadRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clubKey]);

  const deleteTour = async (id: string) => {
    if (!confirm(t("clubAdmin.deleteConfirm"))) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.tournamentDeleted")); load(); }
  };

  const setTourStatus = async (id: string, status: "scheduled" | "live" | "finished" | "cancelled") => {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.statusUpdated")); load(); }
  };

  // "Bắt đầu giải" from the Floor — reuses the SAME canonical clock-start as the
  // operator Clock tab (Edge tournament-live-clock "start": update_tournament_state
  // status='live' + clock_started_at=now + current_level=1). One tap puts the
  // tournament on the Live Tracker AND runs the clock so blinds display.
  const startTournament = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("tournament-live-clock", {
      body: { tournament_id: id, action: "start", current_level: 1 },
    });
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || "Không bắt đầu được giải");
    else { toast.success("Đã bắt đầu giải — đồng hồ chạy, giải lên Live Tracker + hiện blinds"); load(); }
  };

  return (
    <Card className={embedded ? "border-0 bg-transparent shadow-none" : "mb-4 border-primary/20"}>
      {!embedded && (
        <div className="flex items-center justify-between gap-2 p-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 min-w-0 text-left"
          >
            {expanded
              ? <ChevronDown className="w-4 h-4 text-primary shrink-0" />
              : <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
            <CalendarPlus className="w-4 h-4 text-primary shrink-0" />
            <span className="font-display text-primary truncate">Quản lý giải đấu</span>
            <span className="text-xs text-muted-foreground">({tours.length})</span>
          </button>
          {clubIds.length > 0 && (
            <NewTournamentDialog clubs={clubs} defaultClubId={clubIds[0]} multiClub={multiClub} onCreated={load} />
          )}
        </div>
      )}

      {(embedded || expanded) && (
        <div className={embedded ? "" : "px-3 pb-3"}>
          {embedded && clubIds.length > 0 && (
            <div className="flex justify-end mb-3">
              <NewTournamentDialog clubs={clubs} defaultClubId={clubIds[0]} multiClub={multiClub} onCreated={load} />
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : tours.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("clubAdmin.noTournaments")}</p>
          ) : (
            <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1">
              {tours.map((t2) => (
                <Card key={t2.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{t2.name}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)}</div>
                      <div className="mt-0.5"><FomoPrice tournament={t2} /></div>
                      <div className="text-[11px] text-muted-foreground">
                        {t("clubAdmin.stack")}: {t2.starting_stack?.toLocaleString?.() ?? t2.starting_stack}
                        {t2.location ? ` · 📍 ${t2.location}` : ""}
                        {multiClub && clubNameMap[t2.club_id] ? ` · 🏠 ${clubNameMap[t2.club_id]}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <EditTournamentDialog tournament={t2} onSaved={load} />
                      <AuditHistoryDialog tournament={t2} />
                      {FEATURES.blindTemplates && <BlindStructureDialog tournament={t2} />}
                      <Button variant="ghost" size="icon" onClick={() => deleteTour(t2.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <Select value={t2.status} onValueChange={(v) => setTourStatus(t2.id, v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">{t("clubAdmin.scheduled")}</SelectItem>
                      <SelectItem value="live">{t("clubAdmin.live")}</SelectItem>
                      <SelectItem value="finished">{t("clubAdmin.finished")}</SelectItem>
                      <SelectItem value="cancelled">{t("clubAdmin.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <LiveStateEditor tournament={t2} onSaved={load} />
                  {t2.status !== "live" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-9 text-xs border-primary/50 text-primary hover:bg-primary/10"
                      onClick={() => startTournament(t2.id)}
                    >
                      <Play className="w-3.5 h-3.5 mr-1" /> Bắt đầu giải (chạy đồng hồ + lên live)
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// GTD committed guarantee (Phase 3b-D1): empty -> null ("thiếu GTD", never faked from
// prize pool); otherwise a non-negative number. Writes flow through the live audit trigger.
const parseGtd = (v: string): number | null => {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// GTD Phase 3b-D3 — owner-only viewer of the tournament economic-fields audit trail
// (table + RLS from 3b-B; RLS already restricts reads to owner/super_admin, the role
// gate below just hides the button for floor staff). Read-only.
type AuditLogRow = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  changed_fields: string[];
  old_values: Record<string, number | null>;
  new_values: Record<string, number | null>;
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  guarantee_amount: "GTD cam kết",
  buy_in: "Buy-in",
  rake_amount: "Rake / phí",
  service_fee_amount: "Phí dịch vụ",
  prize_pool: "Prize pool",
  starting_stack: "Starting stack",
  minutes_per_level: "Phút / level",
};
const AUDIT_MONEY_FIELDS = new Set(["guarantee_amount", "buy_in", "rake_amount", "service_fee_amount", "prize_pool"]);
const fmtAuditVal = (field: string, v: number | null): string => {
  if (v === null || v === undefined) return "—";
  return AUDIT_MONEY_FIELDS.has(field) ? formatVND(v) : Number(v).toLocaleString("vi-VN");
};

const AuditHistoryDialog = ({ tournament }: { tournament: any }) => {
  const { isClubOwner, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("tournament_economic_audit_log")
        .select("id, changed_at, changed_by, changed_fields, old_values, new_values")
        .eq("tournament_id", tournament.id)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) toast.error(error.message);
      setRows(((data ?? []) as unknown) as AuditLogRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tournament.id]);

  // Owner / super_admin only — RLS also enforces this on the read.
  if (!(isClubOwner || isAdmin)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Lịch sử kinh tế"><History className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lịch sử sửa kinh tế</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{tournament.name} · chỉ chủ CLB / super admin xem.</p>
        {loading && <p className="text-xs text-muted-foreground">Đang tải…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Chưa ghi nhận thay đổi kinh tế nào (chỉ ghi khi SỬA giải, không tính lúc tạo).</p>
        )}
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-2.5 space-y-1 border-primary/30">
              <div className="text-[11px] text-muted-foreground">
                {formatDateTime(r.changed_at)}{r.changed_by ? ` · ${r.changed_by.slice(0, 8)}` : ""}
              </div>
              <ul className="space-y-0.5 text-xs">
                {(r.changed_fields ?? []).map((field) => (
                  <li key={field} className="tabular-nums">
                    <span className="text-muted-foreground">{AUDIT_FIELD_LABELS[field] ?? field}:</span>{" "}
                    {fmtAuditVal(field, r.old_values?.[field] ?? null)}{" "}
                    <span className="text-muted-foreground">→</span>{" "}
                    <span className="text-primary">{fmtAuditVal(field, r.new_values?.[field] ?? null)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const NewTournamentDialog = ({
  clubs, defaultClubId, multiClub, onCreated,
}: {
  clubs: ClubRow[]; defaultClubId: string; multiClub: boolean; onCreated: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState(defaultClubId);
  const [f, setF] = useState({ name: "", start_time: "", buy_in: 1000000, rake_amount: 0, service_fee_amount: 0, guarantee_amount: "", starting_stack: 20000, location: "", description: "", game_type: "nlh", minutes_per_level: 20, late_reg_close_level: 6 });
  const [blindChoice, setBlindChoice] = useState("none");
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setClubId(defaultClubId); }, [defaultClubId]);
  // Load this club's saved blind structures for the picker (gated).
  useEffect(() => {
    if (!FEATURES.blindTemplates || !open || !clubId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("blind_structure_templates")
        .select("id, club_id, name, levels")
        .eq("club_id", clubId)
        .order("name");
      if (!cancelled) setClubTemplates((data ?? []) as BlindTemplate[]);
    })();
    return () => { cancelled = true; };
  }, [open, clubId]);

  const resolveLevels = (choice: string): BlindLevel[] => {
    if (choice.startsWith("preset:")) return BLIND_PRESETS.find((p) => p.key === choice.slice(7))?.levels ?? [];
    if (choice.startsWith("tpl:")) return (clubTemplates.find((t) => t.id === choice.slice(4))?.levels ?? []) as BlindLevel[];
    return [];
  };

  const submit = async () => {
    if (busy) return; // guard: never double-insert on a fast double-click
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    setBusy(true);
    try {
      const { data: created, error } = await supabase.from("tournaments").insert({
        club_id: clubId, name: f.name, start_time: new Date(f.start_time).toISOString(),
        buy_in: Number(f.buy_in), rake_amount: Number(f.rake_amount) || 0,
        ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
        guarantee_amount: parseGtd(f.guarantee_amount),
        starting_stack: Number(f.starting_stack),
        location: f.location, description: f.description, game_type: f.game_type,
        minutes_per_level: Number(f.minutes_per_level), late_reg_close_level: Number(f.late_reg_close_level),
      }).select("id").single();
      if (error) { toast.error(error.message); return; }
      // Seed the blind structure from a chosen preset / club template (gated).
      if (FEATURES.blindTemplates && blindChoice !== "none" && created?.id) {
        const levels = resolveLevels(blindChoice);
        if (levels.length) {
          const { error: lvlErr } = await (supabase as any)
            .from("tournament_levels")
            .insert(levels.map((l) => ({ tournament_id: created.id, ...l })));
          if (lvlErr) toast.error("Tạo giải OK nhưng nạp cấu trúc blind lỗi: " + lvlErr.message);
        }
      }
      toast.success("Tournament created");
      setOpen(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-primary/50 text-primary"><Plus className="w-4 h-4 mr-1" />Tạo giải</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tạo giải đấu</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {multiClub && (
            <>
              <Label>Câu lạc bộ</Label>
              <Select value={clubId} onValueChange={setClubId}>
                <SelectTrigger><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
                <SelectContent>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: +e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: +e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Người chơi trả: <span className="text-primary font-medium">{formatVND((Number(f.buy_in) || 0) + (Number(f.rake_amount) || 0) + (FEATURES.tournamentServiceFee ? (Number(f.service_fee_amount) || 0) : 0))}</span> <span className="opacity-70">(buy-in + rake{FEATURES.tournamentServiceFee ? " + phí dịch vụ" : ""})</span></p>
          <div><Label>GTD cam kết (VND)</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          <p className="text-[11px] text-muted-foreground -mt-1">Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          {FEATURES.blindTemplates && (
            <>
              <Label>Cấu trúc blind</Label>
              <Select value={blindChoice} onValueChange={setBlindChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Để trống (đặt sau ở tab Blind)</SelectItem>
                  {clubTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Mẫu CLB</SelectLabel>
                      {clubTemplates.map((t) => <SelectItem key={t.id} value={`tpl:${t.id}`}>{t.name}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Mẫu chuẩn</SelectLabel>
                    {BLIND_PRESETS.map((p) => <SelectItem key={p.key} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground -mt-1">Chọn cấu trúc có sẵn để giải chạy được ngay (đồng hồ/tracker đọc theo cấu trúc này).</p>
            </>
          )}
          <Button onClick={submit} disabled={busy} className="w-full gradient-neon text-primary-foreground border-0">{busy ? "Đang tạo…" : "Create"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// "Ấn vào để edit bảng blinds" — opens the full level-by-level blind editor
// (BlindEditorPanel: load/save structure + Tải mẫu/Lưu thành mẫu) for this
// tournament in a dialog. The panel is self-contained and production-safe.
const BlindStructureDialog = ({ tournament }: { tournament: any }) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Sửa cấu trúc blind">
          <ListOrdered className="w-4 h-4 text-primary" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Cấu trúc blind — {tournament.name}</DialogTitle></DialogHeader>
        <BlindEditorPanel tournamentId={tournament.id} tournamentStatus={tournament.status} />
      </DialogContent>
    </Dialog>
  );
};

const EditTournamentDialog = ({ tournament, onSaved }: { tournament: any; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [f, setF] = useState({
    name: tournament.name,
    start_time: toLocalInput(tournament.start_time),
    buy_in: tournament.buy_in,
    rake_amount: tournament.rake_amount ?? 0,
    service_fee_amount: tournament.service_fee_amount ?? 0,
    guarantee_amount: tournament.guarantee_amount != null ? String(tournament.guarantee_amount) : "",
    starting_stack: tournament.starting_stack,
    location: tournament.location ?? "",
    description: tournament.description ?? "",
    game_type: tournament.game_type ?? "nlh",
    minutes_per_level: tournament.minutes_per_level ?? 20,
    late_reg_close_level: tournament.late_reg_close_level ?? 6,
  });
  const [saving, setSaving] = useState(false);
  // Part A — "chọn bảng blinds": pick a preset / club template to APPLY to this
  // existing tournament. "none" = keep the current structure. Needs both the
  // templates feature and the full-replace RPC (update_blind_structure).
  const [blindChoice, setBlindChoice] = useState("none");
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const canPickBlinds = FEATURES.blindTemplates && FEATURES.blindEditorSave;
  useEffect(() => {
    if (!canPickBlinds || !open || !tournament.club_id) return;
    let cancelled = false;
    supabase
      .from("blind_structure_templates")
      .select("id, club_id, name, levels")
      .eq("club_id", tournament.club_id)
      .then(({ data }) => { if (!cancelled) setClubTemplates((data ?? []) as unknown as BlindTemplate[]); });
    return () => { cancelled = true; };
  }, [canPickBlinds, open, tournament.club_id]);
  const resolveLevels = (choice: string): BlindLevel[] => {
    if (choice.startsWith("preset:")) return BLIND_PRESETS.find((p) => p.key === choice.slice(7))?.levels ?? [];
    if (choice.startsWith("tpl:")) return (clubTemplates.find((t) => t.id === choice.slice(4))?.levels ?? []) as BlindLevel[];
    return [];
  };
  const save = async () => {
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
    setSaving(true);
    const { error } = await supabase.from("tournaments").update({
      name: f.name,
      start_time: new Date(f.start_time).toISOString(),
      buy_in: Number(f.buy_in),
      rake_amount: Number(f.rake_amount) || 0,
      ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
      guarantee_amount: parseGtd(f.guarantee_amount),
      starting_stack: Number(f.starting_stack),
      location: f.location,
      description: f.description,
      game_type: f.game_type,
      minutes_per_level: Number(f.minutes_per_level),
      late_reg_close_level: Number(f.late_reg_close_level),
    }).eq("id", tournament.id);
    if (error) { setSaving(false); toast.error(error.message); return; }
    // Apply a chosen blind structure (full replace) to this tournament.
    if (canPickBlinds && blindChoice !== "none") {
      const levels = resolveLevels(blindChoice);
      if (levels.length) {
        const { error: blindErr } = await supabase.rpc("update_blind_structure", {
          p_tournament_id: tournament.id,
          p_levels: levels.map((l, i) => ({ level_number: i + 1, ...l })),
        });
        if (blindErr) { setSaving(false); toast.error("Lưu giải OK nhưng nạp cấu trúc blind lỗi: " + blindErr.message); return; }
      }
    }
    setSaving(false);
    toast.success("Saved");
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4 text-primary" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Tournament</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: +e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: +e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Người chơi trả: <span className="text-primary font-medium">{formatVND((Number(f.buy_in) || 0) + (Number(f.rake_amount) || 0) + (FEATURES.tournamentServiceFee ? (Number(f.service_fee_amount) || 0) : 0))}</span> <span className="opacity-70">(buy-in + rake{FEATURES.tournamentServiceFee ? " + phí dịch vụ" : ""})</span></p>
          <div><Label>GTD cam kết (VND)</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          <p className="text-[11px] text-muted-foreground -mt-1">Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
          {canPickBlinds && (
            <>
              <Label>Cấu trúc blind</Label>
              <Select value={blindChoice} onValueChange={setBlindChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Giữ cấu trúc hiện tại</SelectItem>
                  {clubTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Mẫu CLB</SelectLabel>
                      {clubTemplates.map((t) => <SelectItem key={t.id} value={`tpl:${t.id}`}>{t.name}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Mẫu chuẩn</SelectLabel>
                    {BLIND_PRESETS.map((p) => <SelectItem key={p.key} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground -mt-1">
                Chọn mẫu sẽ <span className="text-primary font-medium">THAY</span> toàn bộ cấu trúc blind hiện tại. Hoặc bấm nút{" "}
                <ListOrdered className="inline w-3 h-3 align-text-bottom" /> ở danh sách giải để sửa từng level.
              </p>
            </>
          )}
          <Button onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
