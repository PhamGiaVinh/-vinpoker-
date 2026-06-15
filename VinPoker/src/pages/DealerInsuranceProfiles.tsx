import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { useDealerInsuranceProfiles, type InsuranceDealerRow, type SaveProfileInput } from "@/hooks/useDealerInsuranceProfiles";
import type { InsuranceMode, InsuranceRegionCode } from "@/types/insurance";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, ShieldOff, RefreshCw, AlertCircle, Info, Pencil, Search } from "lucide-react";

const MODE_META: Record<InsuranceMode, { label: string; tone: string }> = {
  NONE: { label: "Không tham gia", tone: "#A4A6A0" },
  STATUTORY: { label: "Có bảo hiểm", tone: "#00FF88" },
  SERIES_ONLY: { label: "Theo series", tone: "#F5C260" },
};
const REGIONS: InsuranceRegionCode[] = ["I", "II", "III", "IV"];
const todayISO = () => new Date().toISOString().slice(0, 10);

const DealerInsuranceProfiles = () => {
  const { isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [clubFilter, setClubFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<InsuranceDealerRow | null>(null);

  const { loading, error, tablesReady, clubs, dealers, rates, reload, saveProfile } =
    useDealerInsuranceProfiles({ clubFilter });

  const filtered = useMemo(
    () => dealers.filter((d) => d.fullName.toLowerCase().includes(q.trim().toLowerCase())),
    [dealers, q],
  );
  const counts = useMemo(() => {
    const c = { NONE: 0, STATUTORY: 0, SERIES_ONLY: 0 } as Record<InsuranceMode, number>;
    dealers.forEach((d) => { c[d.profile?.insurance_mode ?? "NONE"] += 1; });
    return c;
  }, [dealers]);

  // After all hooks (rules-of-hooks).
  if (!(isClubAdmin || isClubOwner)) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-primary">Bảo hiểm dealer</h1>
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
            {isAdmin ? "super_admin · toàn bộ CLB" : "chủ CLB"}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">Tham gia BHXH/BHYT/BHTN theo từng dealer · không đổi công thức lương</div>
      </div>

      {/* Phase-1-not-applied notice */}
      {!tablesReady && (
        <Card className="p-4 border-warning/40 bg-warning/10 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-warning">Bảng cấu hình bảo hiểm chưa được áp dụng</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Cần owner áp dụng migration Phase 1 (<code>dealer_insurance_profiles</code>, <code>insurance_policy_rates</code>) trước khi lưu hồ sơ. Danh sách dưới đây hiển thị mặc định <b>Không tham gia</b>.
            </div>
          </div>
        </Card>
      )}

      {/* Controls */}
      <Card className="p-3 gradient-card border-primary/20">
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && (
            <div>
              <Label className="text-xs text-muted-foreground">Câu lạc bộ</Label>
              <Select value={clubFilter} onValueChange={setClubFilter}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả các CLB</SelectItem>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex-1 min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Tìm dealer</Label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên dealer…" className="h-9 pl-8" />
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-9 ml-auto" onClick={reload} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" /> {error}
        </Card>
      )}

      {/* Region rates reference */}
      {tablesReady && (
        <Card className="p-4 gradient-card border-primary/20 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4 text-primary" /> Biểu phí theo vùng (BHTN cap = 20× lương tối thiểu vùng)</div>
          {rates.length === 0 ? (
            <div className="text-xs text-muted-foreground">Chưa có biểu phí — owner chạy <code>scripts/payroll/seed_insurance_policy_rates_2026.sql</code>.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {REGIONS.map((rc) => {
                const r = rates.find((x) => x.region_code === rc);
                return (
                  <div key={rc} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                    <div className="text-[11px] text-muted-foreground">Vùng {rc}</div>
                    <div className="text-sm font-display font-bold text-primary">{r ? formatVND(r.bhtn_cap_vnd) : "—"}</div>
                    <div className="text-[10px] text-muted-foreground">LTT {r ? formatVND(r.regional_min_wage_vnd) : "—"}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Mode summary */}
      {!loading && dealers.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {(Object.keys(MODE_META) as InsuranceMode[]).map((m) => (
            <span key={m} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2.5 py-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: MODE_META[m].tone }} />
              {MODE_META[m].label} · <b className="text-foreground">{counts[m]}</b>
            </span>
          ))}
        </div>
      )}

      {/* Dealer table */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : (
        <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealer</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Tham gia BH</TableHead>
                  <TableHead>Vùng</TableHead>
                  <TableHead className="text-right">Lương căn cứ BH</TableHead>
                  <TableHead className="text-right">Sửa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Không có dealer phù hợp.</TableCell></TableRow>
                ) : filtered.map((d) => {
                  const mode = d.profile?.insurance_mode ?? "NONE";
                  const meta = MODE_META[mode];
                  return (
                    <TableRow key={d.dealerId}>
                      <TableCell className="text-sm font-medium">{d.fullName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{d.employmentType === "full_time" ? "FT" : d.employmentType === "part_time" ? "PT" : (d.employmentType ?? "—")}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] gap-1" style={{ background: `${meta.tone}22`, color: meta.tone }}>
                          {mode === "NONE" ? <ShieldOff className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />} {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{d.profile?.region_code ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{d.profile?.insurance_salary_vnd != null ? formatVND(d.profile.insurance_salary_vnd) : "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={!tablesReady} onClick={() => setEditing(d)} title={!tablesReady ? "Cần áp dụng Phase 1 trước" : "Sửa hồ sơ bảo hiểm"}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {editing && (
        <ProfileEditor
          dealer={editing}
          regionsWithRates={rates.map((r) => r.region_code)}
          onClose={() => setEditing(null)}
          onSave={async (input) => { await saveProfile(input); setEditing(null); }}
        />
      )}
    </div>
  );
};

function ProfileEditor({ dealer, regionsWithRates, onClose, onSave }: {
  dealer: InsuranceDealerRow;
  regionsWithRates: InsuranceRegionCode[];
  onClose: () => void;
  onSave: (input: SaveProfileInput) => Promise<void>;
}) {
  const p = dealer.profile;
  const [mode, setMode] = useState<InsuranceMode>(p?.insurance_mode ?? "NONE");
  const [region, setRegion] = useState<InsuranceRegionCode | "">(p?.region_code ?? "");
  const [salary, setSalary] = useState<string>(p?.insurance_salary_vnd != null ? String(p.insurance_salary_vnd) : (dealer.monthlySalaryVnd != null ? String(dealer.monthlySalaryVnd) : ""));
  const [bhxh, setBhxh] = useState(p?.include_bhxh ?? true);
  const [bhyt, setBhyt] = useState(p?.include_bhyt ?? true);
  const [bhtn, setBhtn] = useState(p?.include_bhtn ?? true);
  const [seriesId, setSeriesId] = useState(p?.series_id ?? "");
  const [from, setFrom] = useState(p?.effective_from ?? todayISO());
  const [notes, setNotes] = useState(p?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const insured = mode !== "NONE";
  const valid =
    (!insured || (region !== "" && Number(salary) > 0)) &&
    (mode !== "SERIES_ONLY" || seriesId.trim() !== "");

  const handleSave = async () => {
    setErr(null);
    if (!valid) { setErr("Cần chọn vùng + lương căn cứ (và series_id nếu Theo series)."); return; }
    setSaving(true);
    try {
      await onSave({
        dealer_id: dealer.dealerId,
        club_id: dealer.clubId,
        insurance_mode: mode,
        region_code: insured ? (region as InsuranceRegionCode) : null,
        insurance_salary_vnd: insured && salary !== "" ? Math.round(Number(salary)) : null,
        include_bhxh: insured ? bhxh : false,
        include_bhyt: insured ? bhyt : false,
        include_bhtn: insured ? bhtn : false,
        series_id: mode === "SERIES_ONLY" ? seriesId.trim() : null,
        effective_from: from,
        effective_to: null,
        notes: notes.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lưu thất bại");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Bảo hiểm · {dealer.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Tham gia bảo hiểm</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as InsuranceMode)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Không tham gia (cash-only)</SelectItem>
                <SelectItem value="STATUTORY">Có BHXH/BHYT/BHTN</SelectItem>
                <SelectItem value="SERIES_ONLY">Chỉ áp dụng theo series</SelectItem>
              </SelectContent>
            </Select>
            {!insured && <p className="text-[11px] text-muted-foreground mt-1">Dealer cash-only → BHXH/BHYT/BHTN = 0.</p>}
          </div>

          {insured && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Vùng lương tối thiểu</Label>
                  <Select value={region} onValueChange={(v) => setRegion(v as InsuranceRegionCode)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Chọn vùng" /></SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((rc) => (
                        <SelectItem key={rc} value={rc}>Vùng {rc}{regionsWithRates.includes(rc) ? "" : " (chưa có biểu phí)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Lương căn cứ BH (₫)</Label>
                  <Input type="number" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} className="h-9" placeholder="vd 9000000" />
                </div>
              </div>

              {mode === "SERIES_ONLY" && (
                <div>
                  <Label className="text-xs text-muted-foreground">Series ID (bắt buộc)</Label>
                  <Input value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className="h-9" placeholder="UUID của series được cover" />
                </div>
              )}

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs"><Switch checked={bhxh} onCheckedChange={setBhxh} /> BHXH</label>
                <label className="flex items-center gap-2 text-xs"><Switch checked={bhyt} onCheckedChange={setBhyt} /> BHYT</label>
                <label className="flex items-center gap-2 text-xs"><Switch checked={bhtn} onCheckedChange={setBhtn} /> BHTN</label>
              </div>
            </>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Áp dụng từ</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Ghi chú</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Tuỳ chọn…" />
          </div>

          {err && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
            {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> Đang lưu…</> : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Self-gate: never reachable unless the flag is on (route is also flag-gated).
export default FEATURES.insuranceProfiles ? DealerInsuranceProfiles : (() => <Navigate to="/club/admin" replace />);
