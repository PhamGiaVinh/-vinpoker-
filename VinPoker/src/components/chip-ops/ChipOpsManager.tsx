import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Coins, CheckCircle2, AlertTriangle, Lock, Plus, Trash2, Loader2, Link2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardTab } from "./DashboardTab";
import { BankAuditTab } from "./BankAuditTab";

// The chip_ops_* tables/RPCs are applied live but not yet in the generated Database types,
// so all reads/writes go through this loosely-typed client. Strictly additive feature.
const sb = supabase as any;

interface TourRow { id: string; name: string | null; club_id: string | null; }
interface Denom { id: string; value: number; color: string | null; label: string | null; display_order: number; }
interface TemplateRow { id: string; name: string; stack_value: number; lines: { denomination_id: string; count: number }[]; issued_count: number; }
interface InvDenom { denomination_id: string; value: number; color: string | null; issued_count_total: number; }
interface Inventory { denominations: InvDenom[]; total_value: number; reconciliation_value: number; reconciled: boolean; error?: string; }

const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");

// Map server error codes → friendly Vietnamese.
const ERR: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.",
  Forbidden: "Bạn không có quyền thực hiện.",
  NAME_EXISTS: "Tên này đã tồn tại.",
  VALUE_EXISTS: "Mệnh giá này đã có trong bộ chip.",
  DENOM_IN_USE: "Mệnh giá đang được một mẫu stack dùng — không xoá được.",
  DENOM_NOT_FOUND: "Không tìm thấy mệnh giá.",
  NO_CHIP_SET_BINDING: "Giải chưa được gán bộ chip.",
  DENOM_NOT_IN_SET: "Mệnh giá không thuộc bộ chip của giải.",
  DUPLICATE_DENOM: "Trùng mệnh giá trong cùng một mẫu.",
  STACK_SUM_MISMATCH: "Tổng chip không khớp giá trị stack.",
  BINDING_LOCKED_TEMPLATES_EXIST: "Đã có mẫu stack — không đổi bộ chip được nữa.",
  CHIP_SET_CLUB_MISMATCH: "Bộ chip không thuộc CLB của giải.",
  CHIP_SET_NOT_FOUND: "Không tìm thấy bộ chip.",
  TOURNAMENT_NOT_FOUND: "Không tìm thấy giải.",
  TEMPLATE_NOT_FOUND: "Không tìm thấy mẫu stack.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
};

async function callRpc(fn: string, args: Record<string, unknown>): Promise<any | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      toast.error("Tính năng chưa sẵn sàng trên máy chủ.");
      return null;
    }
    if (data && data.error) {
      toast.error(ERR[data.error] ?? data.error);
      return null;
    }
    return data ?? {};
  } catch {
    toast.error("Có lỗi xảy ra, thử lại.");
    return null;
  }
}

export function ChipOpsManager() {
  const { isClubOwner, isChipMaster } = useAuth();
  const allowed = isClubOwner || isChipMaster;
  const [params, setParams] = useSearchParams();

  const [tours, setTours] = useState<TourRow[]>([]);
  const [tournamentId, setTournamentId] = useState<string>(params.get("t") ?? "");
  const tour = useMemo(() => tours.find((t) => t.id === tournamentId) ?? null, [tours, tournamentId]);

  const [loading, setLoading] = useState(false);
  const [boundChipSetId, setBoundChipSetId] = useState<string | null>(null);
  const [clubChipSets, setClubChipSets] = useState<{ id: string; name: string }[]>([]);
  const [denoms, setDenoms] = useState<Denom[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);

  // load tournaments (RLS-scoped)
  useEffect(() => {
    let active = true;
    sb.from("tournaments").select("id,name,club_id,start_time").order("start_time", { ascending: false }).limit(200)
      .then(({ data }: any) => { if (active) setTours((data ?? []).map((t: any) => ({ id: t.id, name: t.name, club_id: t.club_id }))); });
    return () => { active = false; };
  }, []);

  const reload = useCallback(async (tid: string) => {
    if (!tid) { setBoundChipSetId(null); setDenoms([]); setTemplates([]); setInv(null); setClubChipSets([]); return; }
    setLoading(true);
    try {
      const t = tours.find((x) => x.id === tid);
      const clubId = t?.club_id ?? null;

      const [{ data: bindRow }, { data: setsRaw }] = await Promise.all([
        sb.from("tournament_chip_set").select("chip_set_id").eq("tournament_id", tid).maybeSingle(),
        clubId ? sb.from("chip_set").select("id,name").eq("club_id", clubId).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
      ]);
      const csId: string | null = bindRow?.chip_set_id ?? null;
      setBoundChipSetId(csId);
      setClubChipSets((setsRaw ?? []).map((s: any) => ({ id: s.id, name: s.name })));

      if (csId) {
        const { data: dRaw } = await sb.from("chip_set_denomination").select("id,value,color,label,display_order").eq("chip_set_id", csId).order("value", { ascending: true });
        setDenoms((dRaw ?? []) as Denom[]);
      } else {
        setDenoms([]);
      }

      const { data: tplRaw } = await sb.from("stack_template").select("id,name,stack_value").eq("tournament_id", tid).order("stack_value", { ascending: true });
      const tplIds = (tplRaw ?? []).map((x: any) => x.id);
      let lines: any[] = [], issu: any[] = [];
      if (tplIds.length) {
        const [{ data: l }, { data: i }] = await Promise.all([
          sb.from("stack_template_line").select("stack_template_id,denomination_id,count").in("stack_template_id", tplIds),
          sb.from("stack_template_issuance").select("stack_template_id,issued_count").in("stack_template_id", tplIds),
        ]);
        lines = l ?? []; issu = i ?? [];
      }
      setTemplates((tplRaw ?? []).map((x: any) => ({
        id: x.id, name: x.name, stack_value: Number(x.stack_value),
        lines: lines.filter((ln) => ln.stack_template_id === x.id).map((ln) => ({ denomination_id: ln.denomination_id, count: Number(ln.count) })),
        issued_count: Number(issu.find((s) => s.stack_template_id === x.id)?.issued_count ?? 0),
      })));

      const invData = await callRpc("get_issued_chip_inventory", { p_tournament_id: tid });
      setInv(invData && !invData.error ? (invData as Inventory) : null);
    } finally {
      setLoading(false);
    }
  }, [tours]);

  useEffect(() => { if (tournamentId) reload(tournamentId); }, [tournamentId, reload]);

  const onPick = (id: string) => {
    setTournamentId(id);
    const next = new URLSearchParams(params); next.set("t", id); setParams(next, { replace: true });
  };

  if (!allowed) {
    return (
      <Card className="border-border"><CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
        <Lock className="w-5 h-5" /> Bạn không có quyền truy cập Chip Ops.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Topbar — tournament picker shared across all tabs */}
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 shrink-0 text-primary" />
        <Select value={tournamentId} onValueChange={onPick}>
          <SelectTrigger className="w-full sm:w-[340px]"><SelectValue placeholder="Chọn giải đấu" /></SelectTrigger>
          <SelectContent>{tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name ?? t.id}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!tournamentId ? (
        <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">
          Chọn một giải đấu để xem tổng quan và cài đặt chip.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="setup">Setup stack</TabsTrigger>
            <TabsTrigger value="colorup">Color-Up</TabsTrigger>
            <TabsTrigger value="bagtag">Bag &amp; Tag</TabsTrigger>
            <TabsTrigger value="bank">Két / Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            {loading ? <LoadingCard /> : <DashboardTab tournamentId={tournamentId} inv={inv} denoms={denoms} />}
          </TabsContent>

          <TabsContent value="setup" className="mt-4 space-y-4">
            {loading ? <LoadingCard /> : (
              <>
                <ChipSetCard
                  tour={tour}
                  boundChipSetId={boundChipSetId}
                  clubChipSets={clubChipSets}
                  denoms={denoms}
                  busy={busy} setBusy={setBusy}
                  reload={() => reload(tournamentId)}
                />
                {boundChipSetId && denoms.length > 0 && (
                  <TemplatesCard
                    tournamentId={tournamentId}
                    denoms={denoms}
                    templates={templates}
                    busy={busy} setBusy={setBusy}
                    reload={() => reload(tournamentId)}
                  />
                )}
                {templates.length > 0 && (
                  <IssuanceCard templates={templates} busy={busy} setBusy={setBusy} reload={() => reload(tournamentId)} />
                )}
                <InventoryCard inv={inv} />
              </>
            )}
          </TabsContent>

          <TabsContent value="colorup" className="mt-4">
            <ComingSoon title="Color-Up / Chip race" desc="Rút mệnh giá nhỏ khi blind lên, đối soát giá trị bảo toàn." />
          </TabsContent>
          <TabsContent value="bagtag" className="mt-4">
            <ComingSoon title="Bag & Tag — đóng kho cuối ngày" desc="Đóng bao từng người, đối soát theo mệnh giá, khoá ngày." />
          </TabsContent>
          <TabsContent value="bank" className="mt-4">
            <BankAuditTab clubId={tour?.club_id ?? null} tournamentId={tournamentId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function LoadingCard() {
  return (
    <Card className="border-border"><CardContent className="space-y-3 py-6">
      <Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" />
    </CardContent></Card>
  );
}

function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <Card className="border-dashed border-border">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Sparkles className="h-6 w-6 text-primary/60" />
        <div className="font-display text-base text-foreground">{title}</div>
        <div className="max-w-sm text-sm text-muted-foreground">{desc}</div>
        <div className="mt-1 text-xs text-muted-foreground">Đang phát triển — sắp có ở bản cập nhật tới.</div>
      </CardContent>
    </Card>
  );
}

// ---------- Chip set + denominations ----------
function ChipSetCard({ tour, boundChipSetId, clubChipSets, denoms, busy, setBusy, reload }: {
  tour: TourRow | null; boundChipSetId: string | null; clubChipSets: { id: string; name: string }[];
  denoms: Denom[]; busy: boolean; setBusy: (b: boolean) => void; reload: () => void;
}) {
  const [newSetName, setNewSetName] = useState("");
  const [pickSetId, setPickSetId] = useState("");
  const [dValue, setDValue] = useState("");
  const [dColor, setDColor] = useState("#1e88e5");

  const boundName = clubChipSets.find((s) => s.id === boundChipSetId)?.name;

  const createSet = async () => {
    if (!tour?.club_id || !newSetName.trim()) return;
    setBusy(true);
    const r = await callRpc("chip_ops_create_chip_set", { p_club_id: tour.club_id, p_name: newSetName.trim() });
    if (r?.chip_set_id) {
      const b = await callRpc("chip_ops_bind_tournament_chip_set", { p_tournament_id: tour.id, p_chip_set_id: r.chip_set_id });
      if (b) { toast.success("Đã tạo & gán bộ chip."); setNewSetName(""); reload(); }
    }
    setBusy(false);
  };
  const bindExisting = async () => {
    if (!tour || !pickSetId) return;
    setBusy(true);
    const b = await callRpc("chip_ops_bind_tournament_chip_set", { p_tournament_id: tour.id, p_chip_set_id: pickSetId });
    if (b) { toast.success("Đã gán bộ chip."); reload(); }
    setBusy(false);
  };
  const addDenom = async () => {
    const v = Number(dValue);
    if (!boundChipSetId || !Number.isFinite(v) || v <= 0) { toast.error("Nhập mệnh giá > 0."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_add_denomination", { p_chip_set_id: boundChipSetId, p_value: v, p_color: dColor, p_label: null, p_display_order: denoms.length });
    if (r) { toast.success("Đã thêm mệnh giá."); setDValue(""); reload(); }
    setBusy(false);
  };
  const delDenom = async (id: string) => {
    setBusy(true);
    const r = await callRpc("chip_ops_delete_denomination", { p_denomination_id: id });
    if (r) { toast.success("Đã xoá mệnh giá."); reload(); }
    setBusy(false);
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">1. Bộ chip</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!boundChipSetId ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Giải này chưa có bộ chip. Tạo bộ mới hoặc gán bộ có sẵn của CLB.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1"><Label className="text-xs">Tạo bộ chip mới</Label>
                <Input value={newSetName} onChange={(e) => setNewSetName(e.target.value)} placeholder="VD: Bộ chip giải A" /></div>
              <Button onClick={createSet} disabled={busy || !newSetName.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Tạo & gán</Button>
            </div>
            {clubChipSets.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1"><Label className="text-xs">Hoặc gán bộ có sẵn</Label>
                  <Select value={pickSetId} onValueChange={setPickSetId}>
                    <SelectTrigger><SelectValue placeholder="Chọn bộ chip" /></SelectTrigger>
                    <SelectContent>{clubChipSets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <Button variant="secondary" onClick={bindExisting} disabled={busy || !pickSetId}><Link2 className="w-4 h-4" /> Gán</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-foreground">Bộ chip: <span className="font-semibold">{boundName ?? boundChipSetId}</span></div>
            {denoms.length > 0 ? (
              <Table>
                <TableHeader><TableRow><TableHead>Màu</TableHead><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Xoá</TableHead></TableRow></TableHeader>
                <TableBody>
                  {denoms.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell><span className="inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden /></TableCell>
                      <TableCell className="tabular-nums">{fmt(d.value)}</TableCell>
                      <TableCell className="text-right"><Button size="icon" variant="ghost" disabled={busy} onClick={() => delDenom(d.id)} aria-label="Xoá"><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-sm text-muted-foreground">Chưa có mệnh giá. Thêm các mệnh giá (VD 100, 500, 1000, 5000).</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end border-t border-border pt-3">
              <div><Label className="text-xs">Màu</Label><input type="color" value={dColor} onChange={(e) => setDColor(e.target.value)} className="h-10 w-12 rounded border border-border bg-transparent p-1" /></div>
              <div className="flex-1"><Label className="text-xs">Mệnh giá</Label><Input type="number" inputMode="numeric" value={dValue} onChange={(e) => setDValue(e.target.value)} placeholder="VD: 5000" /></div>
              <Button onClick={addDenom} disabled={busy || !dValue}><Plus className="w-4 h-4" /> Thêm mệnh giá</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Stack templates ----------
function TemplatesCard({ tournamentId, denoms, templates, busy, setBusy, reload }: {
  tournamentId: string; denoms: Denom[]; templates: TemplateRow[]; busy: boolean; setBusy: (b: boolean) => void; reload: () => void;
}) {
  const [name, setName] = useState("");
  const [stackValue, setStackValue] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});

  const liveSum = useMemo(
    () => denoms.reduce((acc, d) => acc + (Number(counts[d.id]) || 0) * d.value, 0),
    [counts, denoms],
  );
  const target = Number(stackValue) || 0;
  const hasLines = denoms.some((d) => (Number(counts[d.id]) || 0) > 0);
  const canSave = !!name.trim() && target > 0 && hasLines && liveSum === target;

  const save = async () => {
    const lines = denoms.filter((d) => (Number(counts[d.id]) || 0) > 0).map((d) => ({ denomination_id: d.id, count: Number(counts[d.id]) }));
    setBusy(true);
    const r = await callRpc("chip_ops_save_stack_template", { p_tournament_id: tournamentId, p_name: name.trim(), p_stack_value: target, p_lines: lines });
    if (r?.status === "ok") { toast.success("Đã lưu mẫu stack."); setName(""); setStackValue(""); setCounts({}); reload(); }
    setBusy(false);
  };

  const denomName = (id: string) => { const d = denoms.find((x) => x.id === id); return d ? fmt(d.value) : id; };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">2. Mẫu stack</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {templates.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Thành phần</TableHead><TableHead className="text-right">Giá trị</TableHead></TableRow></TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.lines.map((l) => `${l.count}×${denomName(l.denomination_id)}`).join(" + ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.stack_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1"><Label className="text-xs">Tên mẫu</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: 30K mix" /></div>
            <div className="flex-1"><Label className="text-xs">Giá trị stack</Label><Input type="number" inputMode="numeric" value={stackValue} onChange={(e) => setStackValue(e.target.value)} placeholder="VD: 30000" /></div>
          </div>
          <div>
            <Label className="text-xs">Số chip mỗi mệnh giá</Label>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {denoms.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden />
                  <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(d.value)}</span>
                  <Input type="number" inputMode="numeric" min={0} value={counts[d.id] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d.id]: e.target.value }))} placeholder="0" className="h-9" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tổng đang nhập: <span className={`font-semibold tabular-nums ${target > 0 && liveSum === target ? "text-primary" : liveSum > 0 ? "text-warning" : "text-muted-foreground"}`}>{fmt(liveSum)}</span>{target > 0 && <span className="text-muted-foreground"> / {fmt(target)}</span>}</span>
            <Button onClick={save} disabled={busy || !canSave}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Lưu mẫu</Button>
          </div>
          {target > 0 && hasLines && liveSum !== target && (
            <p className="text-xs text-warning">Tổng chip ({fmt(liveSum)}) phải bằng đúng giá trị stack ({fmt(target)}) mới lưu được.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Issuance ----------
function IssuanceCard({ templates, busy, setBusy, reload }: { templates: TemplateRow[]; busy: boolean; setBusy: (b: boolean) => void; reload: () => void; }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = async (templateId: string) => {
    const raw = vals[templateId];
    const n = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0) { toast.error("Nhập số bộ ≥ 0."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_set_issuance", { p_stack_template_id: templateId, p_issued_count: n });
    if (r?.status === "ok") { toast.success("Đã lưu số bộ phát."); reload(); }
    setBusy(false);
  };
  return (
    <Card className="border-border">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">3. Số bộ đã phát</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Mẫu stack</TableHead><TableHead className="w-40">Số bộ đã phát</TableHead><TableHead className="text-right">Lưu</TableHead></TableRow></TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell><Input type="number" inputMode="numeric" min={0} value={vals[t.id] ?? String(t.issued_count)} onChange={(e) => setVals((v) => ({ ...v, [t.id]: e.target.value }))} className="h-9" /></TableCell>
                <TableCell className="text-right"><Button size="sm" disabled={busy} onClick={() => save(t.id)}>Lưu</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- Read-only inventory ----------
function InventoryCard({ inv }: { inv: Inventory | null }) {
  if (!inv) return null;
  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base text-foreground">Tồn kho chip đã phát</CardTitle>
        {inv.reconciled
          ? <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary"><CheckCircle2 className="w-3.5 h-3.5" /> Khớp số</Badge>
          : <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Lệch số</Badge>}
      </CardHeader>
      <CardContent>
        {inv.denominations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Chưa có mẫu stack hoặc chưa phát bộ nào.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Số chip đã phát</TableHead></TableRow></TableHeader>
            <TableBody>
              {inv.denominations.map((d) => (
                <TableRow key={d.denomination_id}>
                  <TableCell className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden /><span className="tabular-nums">{fmt(d.value)}</span></TableCell>
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
        {!inv.reconciled && <p className="mt-2 text-xs text-destructive">Đối soát lệch: theo mệnh giá {fmt(inv.total_value)} ≠ theo mẫu stack {fmt(inv.reconciliation_value)}.</p>}
      </CardContent>
    </Card>
  );
}

export default ChipOpsManager;
