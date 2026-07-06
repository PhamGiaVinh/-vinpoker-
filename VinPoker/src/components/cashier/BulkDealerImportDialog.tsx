import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, Wand2, Trash2, FileSpreadsheet, FileText, Image as ImageIcon, Copy, X, Plus } from "lucide-react";
import { spreadsheetFileToText } from "@/lib/dealerImport/parseSpreadsheet";
import {
  buildBulkDealerRows, dedupeKey, normalizeName, type EmploymentType,
} from "@/lib/dealerImport/buildBulkDealerPayload";

// Bulk-create dealers from an uploaded file (image/PDF/Word/Excel/CSV). Names are
// extracted by the `parse-dealer-list` Gemini edge fn (spreadsheets are dumped to
// text client-side first). Owner rules: every dealer tier "B" (fixed) + one FT/PT
// choice for the whole batch. Only names come from the file. Gated by
// FEATURES.bulkDealerImport at the call site (flag OFF ⇒ this never mounts).

// P0-2 client-side limits.
const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per binary file
const MAX_NAMES = 1000;

type FileStatus = "pending" | "processing" | "done" | "error";
interface PickedFile {
  id: string;
  file: File;
  kind: "binary" | "spreadsheet";
  status: FileStatus;
  error?: string;
  count: number;
}
interface PreviewName {
  tempId: string;
  name: string;
  selected: boolean;
  duplicate: boolean; // trùng dealer đang hoạt động trong CLB
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

function detectKind(file: File): "binary" | "spreadsheet" {
  const n = (file.name || "").toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return "spreadsheet";
  if (/spreadsheet|excel|csv/.test(file.type || "")) return "spreadsheet";
  return "binary";
}

/** Strip non-digits and parse to a positive VND amount, or null if blank/invalid. */
function parseSalaryVnd(s: string): number | null {
  const digits = String(s ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fmtVnd = (n: number) => n.toLocaleString("vi-VN");

export function BulkDealerImportDialog({
  clubId,
  existingNames,
  onDone,
}: {
  clubId: string;
  /** Active dealer names in this club, for duplicate detection. */
  existingNames: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [names, setNames] = useState<PreviewName[]>([]);
  const [employmentType, setEmploymentType] = useState<EmploymentType>("part_time");
  const [salaryInput, setSalaryInput] = useState(""); // batch salary: PT=hourly, FT=monthly (blank ⇒ null)
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ created: number; total: number; errors: { name: string; error: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(() => new Set(existingNames.map(dedupeKey)), [existingNames]);

  const reset = () => {
    setFiles([]);
    setNames([]);
    setResult(null);
    setAnalyzing(false);
    setCreating(false);
    setSalaryInput("");
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      toast.error(`Tối đa ${MAX_FILES} file mỗi lần. Vui lòng chia nhỏ.`);
      return;
    }
    const accepted: PickedFile[] = [];
    for (const f of incoming.slice(0, room)) {
      const kind = detectKind(f);
      if (kind === "binary" && f.size > MAX_FILE_BYTES) {
        toast.error(`"${f.name}" quá lớn (>10MB). Vui lòng nén hoặc chụp lại nhỏ hơn.`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file: f, kind, status: "pending", count: 0 });
    }
    if (incoming.length > room) toast.info(`Chỉ nhận thêm ${room} file (tối đa ${MAX_FILES}).`);
    setFiles((prev) => [...prev, ...accepted]);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const mergeNames = (incoming: string[]) => {
    setNames((prev) => {
      const seen = new Set(prev.map((p) => dedupeKey(p.name)));
      const next = [...prev];
      for (const raw of incoming) {
        const clean = normalizeName(raw);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        if (next.length >= MAX_NAMES) break;
        seen.add(key);
        const duplicate = existingKeys.has(key);
        next.push({ tempId: crypto.randomUUID(), name: clean, selected: !duplicate, duplicate });
      }
      return next;
    });
  };

  const analyzeAll = async () => {
    const todo = files.filter((f) => f.status === "pending" || f.status === "error");
    if (!todo.length) {
      toast.info("Không có file mới để phân tích");
      return;
    }
    setAnalyzing(true);
    try {
      for (const pf of todo) {
        setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, status: "processing", error: undefined } : f)));
        try {
          let payload: Record<string, unknown>;
          if (pf.kind === "spreadsheet") {
            const dump = await spreadsheetFileToText(pf.file);
            if (!dump.text.trim()) throw new Error("File không có dữ liệu tên đọc được.");
            payload = { club_id: clubId, content_text: dump.text };
          } else {
            const b64 = await fileToBase64(pf.file);
            payload = { club_id: clubId, content_base64: b64, content_mime: pf.file.type || undefined };
          }
          const { data, error } = await supabase.functions.invoke("parse-dealer-list", { body: payload });
          if (error) throw new Error(error.message);
          if ((data as any)?.error) throw new Error((data as any).error);
          const parsedNames: string[] = Array.isArray((data as any)?.names) ? (data as any).names : [];
          const warnings: string[] = Array.isArray((data as any)?.warnings) ? (data as any).warnings : [];
          mergeNames(parsedNames);
          setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, status: "done", count: parsedNames.length } : f)));
          if (warnings.length) toast.info(`${pf.file.name}: ${warnings.slice(0, 2).join(" · ")}`);
          if (parsedNames.length === 0) toast.warning(`${pf.file.name}: không thấy tên nào.`);
        } catch (e: any) {
          const msg = e?.message ?? "Lỗi phân tích";
          setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, status: "error", error: msg } : f)));
          toast.error(`${pf.file.name}: ${msg}`);
        }
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const selectedCount = names.filter((n) => n.selected).length;
  const setAllSelected = (v: boolean) => setNames((prev) => prev.map((n) => ({ ...n, selected: v })));
  const toggleOne = (tempId: string) =>
    setNames((prev) => prev.map((n) => (n.tempId === tempId ? { ...n, selected: !n.selected } : n)));
  const editName = (tempId: string, value: string) =>
    setNames((prev) => prev.map((n) => (n.tempId === tempId ? { ...n, name: value } : n)));
  const removeName = (tempId: string) => setNames((prev) => prev.filter((n) => n.tempId !== tempId));
  const addManual = () =>
    setNames((prev) => [...prev, { tempId: crypto.randomUUID(), name: "", selected: true, duplicate: false }]);

  const createAll = async () => {
    setConfirmOpen(false);
    const chosen = names.filter((n) => n.selected).map((n) => n.name).filter((n) => normalizeName(n).length > 0);
    if (chosen.length === 0) {
      toast.error("Chưa chọn tên nào.");
      return;
    }
    setCreating(true);
    try {
      const rows = buildBulkDealerRows(chosen, { clubId, employmentType, salaryVnd: parseSalaryVnd(salaryInput) });
      const BATCH = 150;
      let created = 0;
      const errors: { name: string; error: string }[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error } = await (supabase.from("dealers") as any).insert(slice);
        if (!error) {
          created += slice.length;
          continue;
        }
        // Cả lô lỗi (insert nhiều dòng là 1 statement) → thử lại từng dòng để cứu dòng tốt.
        for (const row of slice) {
          const { error: e2 } = await (supabase.from("dealers") as any).insert(row);
          if (e2) errors.push({ name: row.full_name, error: e2.message });
          else created++;
        }
      }
      setResult({ created, total: rows.length, errors });
      if (created > 0) {
        toast.success(`Đã tạo ${created}/${rows.length} dealer`);
        onDone();
      }
      if (errors.length) toast.error(`${errors.length} dòng lỗi — xem chi tiết bên dưới.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi khi tạo dealer");
    } finally {
      setCreating(false);
    }
  };

  const copyErrors = () => {
    if (!result?.errors.length) return;
    const text = "Tên\tLỗi\n" + result.errors.map((e) => `${e.name}\t${e.error}`).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Đã copy danh sách lỗi"),
      () => toast.error("Không copy được"),
    );
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 text-xs border-primary/40 text-primary hover:bg-primary/10"
      >
        <Upload className="h-3.5 w-3.5 mr-1" /> Nhập hàng loạt
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-lg bg-popover border border-border text-foreground max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Nhập hàng loạt dealer từ file</DialogTitle>
            <DialogDescription className="sr-only">
              Nhập hàng loạt dealer từ file danh sách tên.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* File picker */}
            <div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { onPickFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }}
              />
              <Button variant="outline" className="w-full border-dashed border-border" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Chọn file (ảnh, PDF, Excel, CSV… tối đa {MAX_FILES})
              </Button>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs">
                      {f.kind === "spreadsheet" ? <FileSpreadsheet className="h-3.5 w-3.5 text-success shrink-0" />
                        : f.file.type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                        : <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                      {f.status === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                      {f.status === "done" && <span className="text-success">{f.count} tên</span>}
                      {f.status === "error" && <span className="text-destructive truncate max-w-[120px]" title={f.error}>lỗi</span>}
                      <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              {files.some((f) => f.status === "pending" || f.status === "error") && (
                <Button className="w-full mt-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={analyzeAll} disabled={analyzing}>
                  {analyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />} Phân tích
                </Button>
              )}
            </div>

            {/* Preview list */}
            {names.length > 0 && (
              <div className="border-t border-border pt-2">
                {/* Batch options */}
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Loại:</span>
                    {(["part_time", "full_time"] as EmploymentType[]).map((et) => (
                      <button
                        key={et}
                        onClick={() => setEmploymentType(et)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                          employmentType === et ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        {et === "part_time" ? "Bán thời gian (PT)" : "Toàn thời gian (FT)"}
                      </button>
                    ))}
                    <span className="text-[11px] text-muted-foreground ml-1">· Hạng: <b className="text-foreground">B</b> (cố định)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button className="text-primary hover:underline" onClick={() => setAllSelected(true)}>Chọn tất cả</button>
                    <button className="text-muted-foreground hover:underline" onClick={() => setAllSelected(false)}>Bỏ chọn</button>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground mb-1.5">
                  {names.length} tên · đã chọn <b className="text-foreground">{selectedCount}</b>
                  {names.some((n) => n.duplicate) && <span className="text-warning"> · dòng ⚠ trùng đã bỏ chọn sẵn</span>}
                </div>

                <div className="max-h-[46vh] overflow-y-auto overscroll-contain rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {names.map((n) => (
                      <div key={n.tempId} className="flex items-center gap-2 px-2 py-1.5">
                        <Checkbox checked={n.selected} onCheckedChange={() => toggleOne(n.tempId)} />
                        <Input
                          value={n.name}
                          onChange={(e) => editName(n.tempId, e.target.value)}
                          className="h-7 text-xs bg-card border-border flex-1"
                          placeholder="Tên dealer"
                        />
                        {n.duplicate && <span className="text-[10px] text-warning whitespace-nowrap" title="Đã có dealer trùng tên trong CLB">⚠ trùng</span>}
                        <button onClick={() => removeName(n.tempId)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={addManual} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <Plus className="h-3 w-3" /> Thêm tên thủ công
                </button>
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="border-t border-border pt-2">
                <div className="text-sm font-semibold text-success">Đã tạo {result.created}/{result.total} dealer</div>
                {result.errors.length > 0 && (
                  <div className="mt-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-destructive">{result.errors.length} dòng lỗi:</span>
                      <button onClick={copyErrors} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /> Copy</button>
                    </div>
                    <div className="max-h-28 overflow-y-auto mt-1 rounded border border-border">
                      <table className="w-full text-[11px]">
                        <tbody>
                          {result.errors.map((e, i) => (
                            <tr key={i} className="border-b border-border/50">
                              <td className="px-2 py-1 font-medium">{e.name}</td>
                              <td className="px-2 py-1 text-destructive">{e.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} className="border-border">Đóng</Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={creating || selectedCount === 0}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Tạo {selectedCount} dealer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* P0-5: xác nhận cuối + chọn loại hình (PT/FT) áp dụng cho tất cả, ngay tại bước tạo */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận tạo {selectedCount} dealer?</AlertDialogTitle>
            <AlertDialogDescription>
              Chọn loại hình + nhập lương áp dụng cho <b>tất cả {selectedCount} dealer</b>. Hạng: <b>B</b> (cố định).
              Các dòng trùng tên đã được bỏ chọn sẵn.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Chọn PT/FT cho cả lô — nút rõ ràng ngay tại bước tạo */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Loại hình (áp dụng cho tất cả):</div>
            <div className="grid grid-cols-2 gap-2">
              {(["part_time", "full_time"] as EmploymentType[]).map((et) => (
                <button
                  key={et}
                  type="button"
                  onClick={() => setEmploymentType(et)}
                  aria-pressed={employmentType === et}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    employmentType === et
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {et === "part_time" ? "Bán thời gian (PT)" : "Toàn thời gian (FT)"}
                </button>
              ))}
            </div>
          </div>

          {/* Lương cho cả lô — nhãn đổi theo PT/FT (PT = lương giờ, FT = lương tháng) */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">
              {employmentType === "part_time" ? "Lương giờ (VND/giờ)" : "Lương tháng (VND/tháng)"} — áp dụng cho tất cả:
            </div>
            <Input
              type="text"
              inputMode="numeric"
              value={salaryInput}
              onChange={(e) => setSalaryInput(e.target.value)}
              placeholder={employmentType === "part_time" ? "VD: 100000 (100k/giờ)" : "VD: 9000000 (9 triệu/tháng)"}
              className="h-9 text-sm bg-card border-border"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              {parseSalaryVnd(salaryInput) != null
                ? `= ${fmtVnd(parseSalaryVnd(salaryInput)!)}đ ${employmentType === "part_time" ? "/giờ" : "/tháng"} cho mỗi dealer`
                : "Bỏ trống nếu muốn nhập lương sau ở màn Quản lý Dealer."}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={createAll} className="bg-success hover:bg-success/90 text-success-foreground">
              Tạo {selectedCount} dealer {employmentType === "part_time" ? "PT" : "FT"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
