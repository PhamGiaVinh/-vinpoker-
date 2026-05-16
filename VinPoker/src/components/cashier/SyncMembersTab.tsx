import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, Upload, Loader2, FileText, Link as LinkIcon, Save } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type ClubRow = { id: string; name: string };
type ParsedRow = { row: number; member_card_id: string; full_name?: string; phone?: string; cccd?: string; ok: boolean; reason?: string };

const HEADER_ALIASES: Record<string, string> = {
  membercardid: "member_card_id", "mã thẻ": "member_card_id", "ma the": "member_card_id", mathe: "member_card_id", cardid: "member_card_id",
  fullname: "full_name", "họ tên": "full_name", "ho ten": "full_name", hoten: "full_name", name: "full_name",
  phonenumber: "phone", phone: "phone", "sđt": "phone", sdt: "phone", "số điện thoại": "phone",
  cccd: "cccd", cmnd: "cccd", "căn cước": "cccd",
};

const normalizeHeader = (h: string) =>
  HEADER_ALIASES[h.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;

const validatePhone = (p?: string) => !p || /^[0-9+\-\s().]{6,20}$/.test(p);
const validateCccd = (c?: string) => !c || /^[0-9]{8,15}$/.test(c.replace(/\s/g, ""));

export default function SyncMembersTab({ clubs }: { clubs: ClubRow[] }) {
  const [clubId, setClubId] = useState<string>(clubs[0]?.id ?? "");
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoUrl, setAutoUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [logs, setLogs] = useState<any[] | null>(null);

  useEffect(() => {
    if (!clubId) return;
    (async () => {
      const { data } = await supabase.from("clubs").select("auto_sync_url").eq("id", clubId).maybeSingle();
      setAutoUrl((data as any)?.auto_sync_url ?? "");
    })();
    loadLogs();
  }, [clubId]);

  const loadLogs = useCallback(async () => {
    if (!clubId) return;
    setLogs(null);
    const { data } = await supabase.from("sync_logs")
      .select("*").eq("club_id", clubId).order("created_at", { ascending: false }).limit(10);
    setLogs(data ?? []);
  }, [clubId]);

  const downloadTemplate = () => {
    const csv = "MemberCardID,FullName,PhoneNumber,CCCD\nMC001,Nguyễn Văn A,0901234567,012345678901\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vinpoker-club-members-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => normalizeHeader(h) ?? `__skip_${h}`,
      complete: (res) => {
        const rows: ParsedRow[] = res.data.map((r, idx) => {
          const member_card_id = (r["member_card_id"] ?? "").trim();
          const full_name = (r["full_name"] ?? "").trim() || undefined;
          const phone = (r["phone"] ?? "").trim() || undefined;
          const cccd = (r["cccd"] ?? "").trim() || undefined;
          let ok = true; let reason: string | undefined;
          if (!member_card_id) { ok = false; reason = "Thiếu MemberCardID"; }
          else if (!validatePhone(phone)) { ok = false; reason = "SĐT không hợp lệ"; }
          else if (!validateCccd(cccd)) { ok = false; reason = "CCCD không hợp lệ"; }
          return { row: idx + 2, member_card_id, full_name, phone, cccd, ok, reason };
        });
        setParsed(rows);
        const okCount = rows.filter((r) => r.ok).length;
        toast.success(`Đã đọc ${rows.length} dòng (${okCount} hợp lệ)`);
      },
      error: (err) => toast.error("Không đọc được CSV: " + err.message),
    });
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const sync = async () => {
    if (!clubId) { toast.error("Chọn CLB trước"); return; }
    const valid = (parsed ?? []).filter((r) => r.ok).map((r) => ({
      member_card_id: r.member_card_id,
      full_name: r.full_name ?? null,
      phone: r.phone ?? null,
      cccd: r.cccd ?? null,
    }));
    if (!valid.length) { toast.error("Không có dòng hợp lệ"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sync-club-members", {
      body: { club_id: clubId, source_type: "csv", rows: valid },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error(error?.message ?? (data as any).error);
      return;
    }
    const { inserted, updated, failed } = data as any;
    toast.success(`✅ Đồng bộ thành công: ${inserted + updated} thành viên (${inserted} mới, ${updated} cập nhật, ${failed} lỗi)`);
    setParsed(null);
    loadLogs();
  };

  const saveAutoUrl = async () => {
    setSavingUrl(true);
    const { error } = await supabase.from("clubs").update({ auto_sync_url: autoUrl || null }).eq("id", clubId);
    setSavingUrl(false);
    if (error) toast.error(error.message); else toast.success("Đã lưu URL đồng bộ");
  };

  const summary = useMemo(() => {
    if (!parsed) return null;
    const ok = parsed.filter((r) => r.ok).length;
    return { total: parsed.length, ok, bad: parsed.length - ok };
  }, [parsed]);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold text-sm">Đồng bộ dữ liệu CLB</div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="w-4 h-4" /> Tải file mẫu
          </Button>
        </div>

        {clubs.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">CLB:</span>
            <select className="bg-background border rounded-md h-9 px-2 text-sm"
              value={clubId} onChange={(e) => setClubId(e.target.value)}>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40 transition"
        >
          <Upload className="w-7 h-7 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm">Kéo & thả file CSV vào đây hoặc bấm để chọn</div>
          <div className="text-xs text-muted-foreground mt-1">Cột: MemberCardID, FullName, PhoneNumber, CCCD</div>
          <input type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>

        {summary && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline">{summary.total} dòng</Badge>
            <Badge className="bg-success/15 text-success border-success/40">{summary.ok} hợp lệ</Badge>
            {summary.bad > 0 && <Badge variant="destructive">{summary.bad} lỗi</Badge>}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setParsed(null)}>Hủy</Button>
              <Button size="sm" onClick={sync} disabled={busy || summary.ok === 0}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Đồng bộ {summary.ok} dòng
              </Button>
            </div>
          </div>
        )}

        {parsed && parsed.length > 0 && (
          <div className="overflow-auto max-h-72 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Mã thẻ</TableHead>
                  <TableHead>Họ tên</TableHead>
                  <TableHead>SĐT</TableHead>
                  <TableHead>CCCD</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.slice(0, 200).map((r) => (
                  <TableRow key={r.row} className={!r.ok ? "bg-destructive/10" : ""}>
                    <TableCell className="text-xs">{r.row}</TableCell>
                    <TableCell className="font-mono text-xs">{r.member_card_id || "—"}</TableCell>
                    <TableCell>{r.full_name ?? "—"}</TableCell>
                    <TableCell>{r.phone ?? "—"}</TableCell>
                    <TableCell>{r.cccd ?? "—"}</TableCell>
                    <TableCell>
                      {r.ok
                        ? <Badge className="bg-success/15 text-success border-success/40">OK</Badge>
                        : <Badge variant="destructive">{r.reason}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {parsed.length > 200 && <div className="text-xs text-center text-muted-foreground py-2">…và {parsed.length - 200} dòng khác</div>}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-semibold text-sm flex items-center gap-2"><LinkIcon className="w-4 h-4" /> URL đồng bộ tự động (tùy chọn)</div>
        <p className="text-xs text-muted-foreground">Dán link CSV public (vd: Google Sheets export). Sẽ được đồng bộ tự động trong tương lai.</p>
        <div className="flex gap-2">
          <Input value={autoUrl} onChange={(e) => setAutoUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv" />
          <Button variant="outline" onClick={saveAutoUrl} disabled={savingUrl}>
            {savingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Lưu
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-semibold text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Lịch sử đồng bộ</div>
        {logs === null ? <Skeleton className="h-24" /> :
          logs.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có lịch sử.</p> :
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Nguồn</TableHead>
                  <TableHead className="text-right">Mới</TableHead>
                  <TableHead className="text-right">Cập nhật</TableHead>
                  <TableHead className="text-right">Lỗi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{formatDateTime(l.created_at)}</TableCell>
                    <TableCell><Badge variant="outline">{l.source_type}</Badge></TableCell>
                    <TableCell className="text-right text-success">{l.records_inserted}</TableCell>
                    <TableCell className="text-right">{l.records_updated}</TableCell>
                    <TableCell className="text-right text-destructive">{l.records_failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        }
      </Card>
    </div>
  );
}
