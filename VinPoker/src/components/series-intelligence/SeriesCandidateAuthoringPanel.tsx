import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarCheck2, Database, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  approveSeriesCandidateFromTournament,
  getSeriesCandidateAuthoringPreview,
  listSeriesCandidateAuthoringSources,
  type ApprovedSeriesCandidateFromTournament,
  type ApproveSeriesCandidateFromTournamentRequest,
  type SeriesCandidateAuthoringPreview,
  type SeriesCandidateAuthoringRpcResult,
  type SeriesCandidateAuthoringSource,
} from "@/lib/series-intelligence/seriesCandidateAuthoringRpc";

type CandidateAuthoringState = "idle" | "loading" | "ready" | "approving" | "approved" | "error";
type FieldSource = "club_schedule" | "owner_input" | "deterministic" | "missing";

const FIELD_SOURCE_LABEL: Readonly<Record<FieldSource, string>> = Object.freeze({
  club_schedule: "Từ lịch CLB",
  owner_input: "Owner nhập",
  deterministic: "Deterministic",
  missing: "Chưa có dữ liệu",
});

const FIELD_SOURCE_CLASS: Readonly<Record<FieldSource, string>> = Object.freeze({
  club_schedule: "border-primary/35 bg-primary/10 text-primary",
  owner_input: "border-warning/35 bg-warning/10 text-warning",
  deterministic: "border-border bg-muted/30 text-muted-foreground",
  missing: "border-destructive/30 bg-destructive/10 text-destructive",
});

export interface SeriesCandidateAuthoringApi {
  readonly listSources: (clubId: string) => Promise<SeriesCandidateAuthoringRpcResult<ReadonlyArray<SeriesCandidateAuthoringSource>>>;
  readonly getPreview: (clubId: string, tournamentId: string) => Promise<SeriesCandidateAuthoringRpcResult<SeriesCandidateAuthoringPreview>>;
  readonly approve: (request: ApproveSeriesCandidateFromTournamentRequest) => Promise<SeriesCandidateAuthoringRpcResult<ApprovedSeriesCandidateFromTournament>>;
}

const defaultApi: SeriesCandidateAuthoringApi = Object.freeze({
  listSources: listSeriesCandidateAuthoringSources,
  getPreview: getSeriesCandidateAuthoringPreview,
  approve: approveSeriesCandidateFromTournament,
});

function formatVnd(value: string | null): string {
  if (value === null) return "Chưa có dữ liệu";
  try {
    return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
  } catch {
    return "Chưa có dữ liệu";
  }
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Chưa có dữ liệu";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Chưa có dữ liệu"
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function parseNonNegativeSafeInteger(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveSafeInteger(value: string): number | null {
  const parsed = parseNonNegativeSafeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function SourceBadge({ source }: { readonly source: FieldSource }) {
  return <Badge variant="outline" className={`shrink-0 text-[10px] ${FIELD_SOURCE_CLASS[source]}`}>{FIELD_SOURCE_LABEL[source]}</Badge>;
}

function FactRow({
  label,
  value,
  source,
}: {
  readonly label: string;
  readonly value: string;
  readonly source: FieldSource;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-xs font-medium text-foreground">
        <span className="break-words">{value}</span>
        <SourceBadge source={source} />
      </span>
    </div>
  );
}

function humanizeError(error: string): string {
  switch (error) {
    case "forbidden": return "Bạn không có quyền duyệt lịch này cho V.";
    case "backend_unavailable": return "Server Candidate Authoring chưa sẵn sàng. Không có bản ghi nào được tạo.";
    case "readback_mismatch": return "Server không xác nhận được đúng một phương án đã duyệt. Không tiếp tục gọi V.";
    case "malformed_response": return "Phản hồi server không đúng hợp đồng. Không có bản ghi nào được tin cậy.";
    default: return "Không thể xử lý phương án này. Không có bản ghi nào được tạo.";
  }
}

export function SeriesCandidateAuthoringPanel({
  clubId,
  api = defaultApi,
}: {
  readonly clubId: string | null;
  readonly api?: SeriesCandidateAuthoringApi;
}) {
  const [state, setState] = useState<CandidateAuthoringState>("idle");
  const [sources, setSources] = useState<ReadonlyArray<SeriesCandidateAuthoringSource>>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [preview, setPreview] = useState<SeriesCandidateAuthoringPreview | null>(null);
  const [gtdInput, setGtdInput] = useState("");
  const [prizeContributionInput, setPrizeContributionInput] = useState("");
  const [flightsInput, setFlightsInput] = useState("");
  const [durationInput, setDurationInput] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [approved, setApproved] = useState<ApprovedSeriesCandidateFromTournament | null>(null);

  useEffect(() => {
    let active = true;
    setSources([]);
    setSelectedTournamentId("");
    setPreview(null);
    setApproved(null);
    setConfirmed(false);
    if (!clubId) {
      setState("idle");
      setMessage("Chọn Club Pulse thật trước khi duyệt một lịch cho V.");
      return () => { active = false; };
    }
    setState("loading");
    setMessage(null);
    api.listSources(clubId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState("error");
        setMessage(humanizeError(result.error));
        return;
      }
      setSources(result.value);
      setState("ready");
    });
    return () => { active = false; };
  }, [api, clubId]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setApproved(null);
    setConfirmed(false);
    setPrizeContributionInput("");
    setFlightsInput("");
    setDurationInput("");
    if (!clubId || !selectedTournamentId) {
      setGtdInput("");
      return () => { active = false; };
    }
    setState("loading");
    setMessage(null);
    api.getPreview(clubId, selectedTournamentId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState("error");
        setMessage(humanizeError(result.error));
        return;
      }
      setPreview(result.value);
      setGtdInput(result.value.fields.scheduleGtdVnd.value ?? "");
      setState("ready");
    });
    return () => { active = false; };
  }, [api, clubId, selectedTournamentId]);

  const selectedSource = sources.find((source) => source.tournamentId === selectedTournamentId) ?? null;
  const gtd = parseNonNegativeSafeInteger(gtdInput);
  const prizeContribution = prizeContributionInput.trim() === "" ? null : parsePositiveSafeInteger(prizeContributionInput);
  const flights = parsePositiveSafeInteger(flightsInput);
  const duration = durationInput.trim() === "" ? null : parsePositiveSafeInteger(durationInput);
  const hasInvalidOptionalInput = (prizeContributionInput.trim() !== "" && prizeContribution === null)
    || (durationInput.trim() !== "" && duration === null);
  const canApprove = Boolean(
    clubId
    && preview?.state === "ready"
    && gtd !== null
    && flights !== null
    && !hasInvalidOptionalInput
    && confirmed
    && state !== "approving",
  );

  const scheduleGtdIsFixed = preview?.fields.scheduleGtdVnd.source === "club_schedule";
  const fieldRows = useMemo(() => preview ? [
    { label: "Tên giải", value: preview.fields.eventName.value, source: preview.fields.eventName.source },
    { label: "Thời điểm bắt đầu", value: formatTimestamp(preview.fields.scheduledStartAt.value), source: preview.fields.scheduledStartAt.source },
    { label: "Buy-in", value: formatVnd(preview.fields.buyInVnd.value), source: preview.fields.buyInVnd.source },
    { label: "Phí tổ chức", value: formatVnd(preview.fields.feeVnd.value), source: preview.fields.feeVnd.source },
    { label: "Phí dịch vụ", value: formatVnd(preview.fields.serviceFeeVnd.value), source: preview.fields.serviceFeeVnd.source },
    { label: "Cấu trúc", value: "Chưa đủ cấu trúc để xác nhận", source: preview.fields.structureState.source },
    { label: "Sức chứa", value: "Chưa có kết luận", source: preview.fields.capacityState.source },
    { label: "Xung đột lịch", value: "Chưa có kết luận", source: preview.fields.collisionState.source },
  ] : [], [preview]);

  const approve = async () => {
    if (!clubId || !preview || !canApprove || gtd === null || flights === null) return;
    setState("approving");
    setMessage(null);
    const result = await api.approve({
      clubId,
      tournamentId: preview.tournamentId,
      gtdVnd: gtd,
      prizeContributionPerEntryVnd: prizeContribution,
      flights,
      expectedDurationMinutes: duration,
    });
    if (!result.ok) {
      setState("error");
      setMessage(humanizeError(result.error));
      return;
    }
    setApproved(result.value);
    setState("approved");
  };

  return (
    <section aria-labelledby="series-candidate-authoring-title" className="rounded-lg border border-primary/35 bg-card/55 p-4 shadow-sm" data-testid="series-candidate-authoring-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarCheck2 className="h-5 w-5 text-primary" aria-hidden />
            <h2 id="series-candidate-authoring-title" className="font-display text-lg text-foreground">Duyệt lịch cho V phân tích</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            Chọn một lịch CLB đã có. V chỉ nhận phương án sau khi server kiểm tra lại nguồn, tạo phiên bản và xác nhận đọc lại.
          </p>
        </div>
        <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">Server kiểm tra nguồn</Badge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <label htmlFor="series-candidate-source" className="block text-sm font-medium text-foreground">Lịch CLB</label>
          <select
            id="series-candidate-source"
            aria-label="Chọn lịch CLB cho V"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={selectedTournamentId}
            disabled={!clubId || state === "loading" || state === "approving"}
            onChange={(event) => setSelectedTournamentId(event.target.value)}
          >
            <option value="">{state === "loading" ? "Đang đọc lịch CLB…" : "Chọn một lịch đã lên ngày"}</option>
            {sources.map((source) => <option key={source.tournamentId} value={source.tournamentId}>{source.labelVi} · {formatTimestamp(source.scheduledStartAt)}</option>)}
          </select>
          {state === "ready" && clubId && sources.length === 0 && (
            <p role="status" className="rounded-md border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">
              Chưa có lịch CLB tương lai ở trạng thái chuẩn bị hoặc đang mở đăng ký, với buy-in hợp lệ để duyệt cho V.
            </p>
          )}
          {selectedSource && <p className="text-[11px] text-muted-foreground">Mã phương án: <span className="font-mono">{selectedSource.optionId}</span></p>}

          {preview && (
            <div className="space-y-3 border-t border-border/60 pt-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Thông tin server đã đọc</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">Không dùng buy-in để suy ra prize contribution hoặc fee.</p>
              </div>
              <div>
                {fieldRows.map((row) => <FactRow key={row.label} {...row} />)}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-border/60 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Các giá trị cần xác nhận</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Các ô owner nhập được gắn nguồn riêng trong candidate versioned.</p>
          </div>

          <label className="block space-y-1">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">GTD <SourceBadge source={preview?.fields.scheduleGtdVnd.source ?? "missing"} /></span>
            <Input aria-label="GTD phương án" inputMode="numeric" value={gtdInput} disabled={!preview || scheduleGtdIsFixed || state === "approving"} onChange={(event) => setGtdInput(event.target.value)} placeholder="Nhập GTD VND" />
            {preview?.fields.scheduleGtdVnd.source === "owner_input" && <span className="text-[11px] text-muted-foreground">Lịch CLB chưa có GTD; owner phải nhập rõ.</span>}
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">Prize contribution mỗi entry <SourceBadge source="owner_input" /></span>
            <Input aria-label="Prize contribution mỗi entry" inputMode="numeric" value={prizeContributionInput} disabled={!preview || state === "approving"} onChange={(event) => setPrizeContributionInput(event.target.value)} placeholder="Để trống nếu chưa có" />
            <span className="text-[11px] text-muted-foreground">Không tự lấy buy-in trừ fee. Để trống thì Required Field sẽ chưa có.</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="flex items-center gap-2 text-xs font-medium text-foreground">Số flight <SourceBadge source="owner_input" /></span>
              <Input aria-label="Số flight" inputMode="numeric" value={flightsInput} disabled={!preview || state === "approving"} onChange={(event) => setFlightsInput(event.target.value)} placeholder="Ví dụ: 1" />
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-2 text-xs font-medium text-foreground">Thời lượng dự kiến (phút) <SourceBadge source="owner_input" /></span>
              <Input aria-label="Thời lượng dự kiến" inputMode="numeric" value={durationInput} disabled={!preview || state === "approving"} onChange={(event) => setDurationInput(event.target.value)} placeholder="Để trống nếu chưa có" />
            </label>
          </div>

          {preview?.state === "blocked" && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Lịch này chưa đủ điều kiện để duyệt: {preview.blockers.join(", ")}.</span>
            </div>
          )}
          {preview && (gtd === null || flights === null || hasInvalidOptionalInput) && (
            <p className="text-xs text-warning">Nhập GTD không âm và số flight hợp lệ. Các giá trị tùy chọn nếu có phải là số nguyên dương.</p>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 p-3 text-xs leading-5 text-muted-foreground">
            <Checkbox aria-label="Xác nhận duyệt lịch cho V" checked={confirmed} disabled={!preview || state === "approving"} onCheckedChange={(checked) => setConfirmed(checked === true)} />
            <span>Tôi xác nhận đây là phương án lịch thật để V phân tích. Thao tác này tạo một candidate versioned trên server; không gọi Gemini và không thay đổi lịch CLB.</span>
          </label>

          <Button type="button" className="w-full gap-2" disabled={!canApprove} onClick={approve}>
            {state === "approving" ? <Database className="h-4 w-4 animate-pulse" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
            {state === "approving" ? "Đang xác nhận trên server…" : "Duyệt cho V phân tích"}
          </Button>
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> Vẫn cần owner hỏi V riêng sau khi server xác nhận candidate. Không có đề xuất GTD hoặc thao tác tiền tự động.</p>
        </div>
      </div>

      {message && <div role="alert" className="mt-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-xs text-destructive">{message}</div>}
      {approved && (
        <div role="status" data-testid="series-candidate-approved" className="mt-4 rounded-md border border-primary/35 bg-primary/10 p-3 text-xs text-foreground">
          <div className="flex items-center gap-2 font-medium text-primary"><BadgeCheck className="h-4 w-4" aria-hidden /> Server đã xác nhận phương án đã duyệt</div>
          <p className="mt-1.5 text-muted-foreground">Revision {approved.approval.revision} · Required Field: {approved.candidate.requiredField === null ? "chưa có do thiếu prize contribution" : new Intl.NumberFormat("vi-VN").format(approved.candidate.requiredField)}. V có thể đọc phương án này trong lần hỏi tiếp theo.</p>
        </div>
      )}
    </section>
  );
}
