import { useRef, useState } from "react";
import { FileSpreadsheet, Download, Upload, Info, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SERIES_INTEL } from "@/lib/seriesIntelligence";
import {
  parseSeriesCsv,
  SAMPLE_CSV_TEXT,
  type CsvParseResult,
} from "@/lib/series-intelligence/csvImport";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";

/**
 * CSV import (client-side test/what-if data). Lets the owner download a template, upload a CSV,
 * and feed it into the dashboard via `onLoaded`. NOTHING is written to the database — the parsed
 * events stay in the browser session (source: 'csv'). Honest: parse errors are shown, not hidden.
 */
export function CsvImportPanel({
  onLoaded,
  onClear,
  isLoaded,
}: {
  onLoaded: (events: SeriesEvent[]) => void;
  onClear: () => void;
  isLoaded: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseSeriesCsv(text);
    setResult(parsed);
    if (parsed.events.length > 0) onLoaded(parsed.events);
    // allow re-selecting the same file name to re-trigger change
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearAll = (): void => {
    setResult(null);
    setFileName(null);
    onClear();
  };

  const fileLevelError = result?.errors.find((er) => er.row === 0);
  const rowErrors = result?.errors.filter((er) => er.row > 0) ?? [];

  return (
    <div className="space-y-3">
      {/* what this is */}
      <Card className="p-3 border-primary/30 bg-primary/5 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0" />
        <span>
          Tải lên CSV để xem dashboard chạy thử với dữ liệu của bạn. Dữ liệu này{" "}
          <strong>chỉ nằm trên trình duyệt</strong> — không lưu vào hệ thống, không ảnh hưởng dữ liệu thật.
        </span>
      </Card>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
          <Download className="w-4 h-4" /> Tải mẫu CSV
        </Button>
        <Button size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" /> Tải lên CSV
        </Button>
        {isLoaded && (
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={clearAll}>
            <X className="w-4 h-4" /> Về dữ liệu live
          </Button>
        )}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </div>

      {/* parse feedback */}
      {result && (
        <Card className="p-3 gradient-card border-primary/40 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            {result.events.length > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            )}
            <span className="font-medium">
              {fileName ? `${fileName}: ` : ""}
              {result.events.length} sự kiện đọc được{" "}
              <span className="text-muted-foreground">/ {result.totalRows} dòng dữ liệu</span>
            </span>
          </div>

          {fileLevelError && (
            <div className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{fileLevelError.message}</span>
            </div>
          )}

          {rowErrors.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {rowErrors.length} ô có vấn đề (đã để trống, không bịa số):
              </div>
              <ul className="space-y-0.5">
                {rowErrors.slice(0, 6).map((er, i) => (
                  <li key={i} className="flex gap-1.5 text-warning">
                    <span aria-hidden>•</span>
                    <span>
                      Dòng {er.row}
                      {er.column ? ` · ${er.column}` : ""}: {er.message}
                    </span>
                  </li>
                ))}
                {rowErrors.length > 6 && (
                  <li className="text-muted-foreground">…và {rowErrors.length - 6} ô khác.</li>
                )}
              </ul>
            </div>
          )}

          {result.events.length > 0 && (
            <p className="text-muted-foreground">
              Dashboard phía trên đang hiển thị dữ liệu CSV này (có nhãn “dữ liệu test”). Bấm “Về dữ liệu live” để quay lại.
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
