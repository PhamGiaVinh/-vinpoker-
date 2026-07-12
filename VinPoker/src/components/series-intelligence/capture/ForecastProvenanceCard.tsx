import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { shortHash } from "@/lib/series-intelligence/hashPlayerRef";
import type { ForecastSnapshot } from "@/lib/series-intelligence/captureTypes";

function statusFor(snapshot: ForecastSnapshot): { label: string; variant: "default" | "secondary" | "outline" } {
  if (snapshot.provenance_kind === "manual") return { label: "Nhập tay", variant: "secondary" };
  if (snapshot.provenance_kind === "engine") {
    return snapshot.provenance_completeness === "missing_code_sha"
      ? { label: "Thiếu mã phiên bản", variant: "outline" }
      : { label: "Đầy đủ", variant: "default" };
  }
  return { label: "Dữ liệu cũ", variant: "outline" };
}

function timeLabel(value: string | null): string {
  return value ? formatShortDate(value) : "—";
}

function TechnicalRow({ label, value }: { label: string; value: string | number | boolean | null }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-left font-mono text-foreground sm:max-w-[70%] sm:text-right">{value ?? "—"}</dd>
    </div>
  );
}

/** Read-only B2 provenance summary for an already persisted forecast snapshot. */
export function ForecastProvenanceCard({ snapshot }: { snapshot: ForecastSnapshot }) {
  const { isAdmin, isClubOwner } = useAuth();
  const status = statusFor(snapshot);
  const canSeeTechnicalDetails = isAdmin || isClubOwner;
  const eligibility = snapshot.forecast_identity_eligible === true
    ? "Có thể dùng làm danh tính dự báo"
    : "Chưa đủ điều kiện";

  return (
    <div role="group" aria-label="Dấu vết dự báo" className="mt-2 space-y-2 rounded-md border border-border/60 bg-muted/10 p-2.5 text-[10px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="font-medium text-foreground">Dấu vết dự báo</span>
        <Badge variant={status.variant} className="h-5 px-1.5 text-[9px]">{status.label}</Badge>
        <span className="ml-auto text-muted-foreground">{eligibility}</span>
      </div>
      <dl className="grid gap-x-3 gap-y-1 text-muted-foreground sm:grid-cols-3">
        <div><dt>Thời điểm phát hành</dt><dd className="text-foreground">{timeLabel(snapshot.forecast_issued_at)}</dd></div>
        <div><dt>Dữ liệu tính đến</dt><dd className="text-foreground">{timeLabel(snapshot.as_of_ts)}</dd></div>
        <div><dt>Thời điểm sự kiện</dt><dd className="text-foreground">{timeLabel(snapshot.target_event_ts)}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {snapshot.engine_version && <span>Phiên bản mô hình: <b className="font-normal text-foreground">{snapshot.engine_version}</b></span>}
        {snapshot.forecast_instance_id && <span>Ref: <b className="font-mono font-normal text-foreground">{shortHash(snapshot.forecast_instance_id)}</b></span>}
      </div>
      {canSeeTechnicalDetails && (
        <details className="border-t border-border/50 pt-2">
          <summary className="cursor-pointer text-muted-foreground">Chi tiết kỹ thuật</summary>
          <dl className="mt-2 space-y-1">
            <TechnicalRow label="Code SHA" value={snapshot.code_sha} />
            <TechnicalRow label="Feature schema" value={snapshot.feature_schema_version} />
            <TechnicalRow label="Predictor ID" value={snapshot.predictor_id} />
            <TechnicalRow label="Calibration pool" value={snapshot.calibration_pool_id} />
            <TechnicalRow label="Target input hash" value={snapshot.target_input_hash} />
            <TechnicalRow label="Training data hash" value={snapshot.training_data_hash} />
            <TechnicalRow label="Input content hash" value={snapshot.input_content_hash} />
            <TechnicalRow label="Derived input hash" value={snapshot.derived_from_input_hash} />
          </dl>
        </details>
      )}
    </div>
  );
}
