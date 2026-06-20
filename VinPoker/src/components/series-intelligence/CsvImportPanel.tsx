import { useRef, useState } from "react";
import { FileSpreadsheet, Download, Upload, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SERIES_INTEL } from "@/lib/seriesIntelligence";
import { parseSeriesCsv, SAMPLE_CSV_TEXT, type CsvParseError } from "@/lib/series-intelligence/csvImport";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { MAX_FILE_BYTES } from "@/lib/series-intelligence/seriesLibrary";

type OutcomeStatus = "ok" | "empty" | "too-big" | "read-error" | "skipped-dup";

interface FileOutcome {
  filename: string;
  status: OutcomeStatus;
  events: number;
  rows: number;
  errors: CsvParseError[];
}

/**
 * CSV import (client-side test/what-if data) — MULTI-FILE. Each selected file = one series; repeated
 * uploads accumulate into the Series Library (`onSeriesParsed` per file with events). NOTHING is
 * written to the DB — parsed events live in the browser session (source: 'csv'). Honest: per-file
 * outcomes + parse errors are shown, never hidden. A same-filename upload asks for confirmation.
 */
export function CsvImportPanel({
  onSeriesParsed,
  loadedCount,
  existingFilenames,
  lastSaveError,
}: {
  onSeriesParsed: (filename: string, events: SeriesEvent[]) => void;
  loadedCount: number;
  existingFilenames: string[];
  lastSaveError?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [outcomes, setOutcomes] = useState<FileOutcome[] | null>(null);

  const downloadTemplate = (): void => {
    const blob = new Blob([SAMPLE_CSV_TEXT], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "series-intelligence-mau.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const batch: FileOutcome[] = [];
    const seenThisBatch = new Set<string>();

    for (const file of files) {
      // size guard BEFORE reading (cheap + accurate)
      if (file.size > MAX_FILE_BYTES) {
        batch.push({ filename: file.name, status: "too-big", events: 0, rows: 0, errors: [] });
        continue;
      }
      // dup soft-warning (P2-1): same filename already in the library or earlier in this batch
      const isDup = existingFilenames.includes(file.name) || seenThisBatch.has(file.name);
      if (isDup && !window.confirm(`"${file.name}" trùng tên một series đã nạp — vẫn thêm?`)) {
        batch.push({ filename: file.name, status: "skipped-dup", events: 0, rows: 0, errors: [] });
        continue;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        batch.push({ filename: file.name, status: "read-error", events: 0, rows: 0, errors: [] });
        continue;
      }
      const parsed = parseSeriesCsv(text);
      seenThisBatch.add(file.name);
      if (parsed.events.length > 0) {
        onSeriesParsed(file.name, parsed.events);
        batch.push({ filename: file.name, status: "ok", events: parsed.events.length, rows: parsed.totalRows, errors: parsed.errors });
      } else {
        batch.push({ filename: file.name, status: "empty", events: 0, rows: parsed.totalRows, errors: parsed.errors });
      }
    }

    setOutcomes(batch);
    if (fileRef.current) fileRef.current.value = ""; // allow re-selecting same files
  };

  const okCount = outcomes?.filter((o) => o.status === "ok").length ?? 0;
  const aggRowErrors = (outcomes ?? []).flatMap((o) => o.errors.filter((er) => er.row > 0).map((er) => ({ file: o.filename, er })));

  const statusLabel: Record<OutcomeStatus, string> = {
    ok: "đã nạp",
    empty: "không có sự kiện hợp lệ",
    "too-big": "file quá lớn (> 1MB)",
    "read-error": "không đọc được file",
    "skipped-dup": "bỏ qua (trùng tên)",
  };

  return (
    <div className="space-y-3">
      {/* what this is */}
      <Card className="p-3 border-primary/30 bg-primary/5 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0" />
        <span>
          Tải lên một hoặc nhiều CSV (mỗi file = 1 series) để xem dashboard chạy thử. Các series tích lũy thành
          “Thư viện Series” và <strong>chỉ nằm trên trình duyệt này</strong> — không lưu vào hệ thống, không ảnh
          hưởng dữ liệu thật. Tải lại trang vẫn còn.
        </span>
      </Card>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
          <Download className="w-4 h-4" /> Tải mẫu CSV
        </Button>
        <Button size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" /> Tải lên CSV {loadedCount > 0 ? "(thêm)" : ""}
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={onFiles} />
      </div>

      {/* save guard error (size / quota) */}
      {lastSaveError && (
        <Card className="p-3 border-warning/50 bg-warning/10 flex items-start gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <span>{lastSaveError} (Thư viện vẫn dùng được trong phiên này, nhưng có thể không lưu được.)</span>
        </Card>
      )}

      {/* per-file outcomes */}
      {outcomes && (
        <Card className="p-3 gradient-card border-primary/40 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-medium">
            {okCount > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            )}
            <span>
              Đã nạp {okCount}/{outcomes.length} file
            </span>
          </div>

          <ul className="space-y-0.5">
            {outcomes.map((o, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {o.status === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className={o.status === "ok" ? "" : "text-warning"}>
                  <span className="font-medium">{o.filename}</span> — {statusLabel[o.status]}
                  {o.status === "ok" ? ` (${o.events} sự kiện / ${o.rows} dòng)` : ""}
                </span>
              </li>
            ))}
          </ul>

          {aggRowErrors.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {aggRowErrors.length} ô có vấn đề (đã để trống, không bịa số):
              </div>
              <ul className="space-y-0.5">
                {aggRowErrors.slice(0, 6).map(({ file, er }, i) => (
                  <li key={i} className="flex gap-1.5 text-warning">
                    <span aria-hidden>•</span>
                    <span>
                      {file} · dòng {er.row}
                      {er.column ? ` · ${er.column}` : ""}: {er.message}
                    </span>
                  </li>
                ))}
                {aggRowErrors.length > 6 && (
                  <li className="text-muted-foreground">…và {aggRowErrors.length - 6} ô khác.</li>
                )}
              </ul>
            </div>
          )}

          {okCount > 0 && (
            <p className="text-muted-foreground">
              Chọn series trong “Thư viện Series” phía trên để xem; dashboard hiển thị series đang chọn (nhãn “dữ liệu test”).
            </p>
          )}
        </Card>
      )}

      {/* format reference — the 4 steps + required columns (kept from the legacy content) */}
      <div className="space-y-3">
        {SERIES_INTEL.steps.map((s) => (
          <Card key={s.n} className="p-4 gradient-card border-primary/40 flex items-start gap-3">
            <div className="grid place-items-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-semibold shrink-0">
              {s.n}
            </div>
            <div>
              <h3 className="font-display text-base">{s.label}</h3>
              <p className="text-xs text-muted-foreground">{s.desc}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 gradient-card border-primary/40">
        <h3 className="font-display text-base flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-4 h-4 text-primary" /> Cột CSV cần chuẩn bị
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {SERIES_INTEL.requiredColumns.map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[11px]">
              {c}
            </Badge>
          ))}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{SERIES_INTEL.eventIdNote}</span>
        </p>
      </Card>
    </div>
  );
}
