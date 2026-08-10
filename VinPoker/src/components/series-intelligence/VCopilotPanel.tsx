import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Database, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  askMockSeriesCopilotV1,
  createMockSeriesCopilotContextV1,
} from "@/lib/series-intelligence/seriesCopilotMockAdapter";
import { askSeriesCopilotEdgeV1 } from "@/lib/series-intelligence/seriesCopilotEdgeClient";
import { renderValidatedCopilotText } from "@/lib/series-intelligence/seriesCopilotEvidenceValidator";
import type { ClubPulseV1, SeriesCopilotContextV1 } from "@/lib/series-intelligence/seriesCopilotContextV1";
import type { VResponseValidationResultV1 } from "@/lib/series-intelligence/seriesCopilotResponseV1";
import { DataGapPanel } from "./DataGapPanel";
import { ScheduleHealthPanel } from "./ScheduleHealthPanel";
import { VThinkingIndicator } from "./VThinkingIndicator";

interface AskVRequest {
  untrustedQuestion: string;
  context: SeriesCopilotContextV1 | null;
  clubId: string | null;
  signal?: AbortSignal;
}
interface AskVResult {
  context: SeriesCopilotContextV1;
  contextHash: string;
  validation: VResponseValidationResultV1;
  receipt?: { modelId: string };
}
type AskV = (request: AskVRequest) => Promise<AskVResult>;
type RequestState = "idle" | "solving" | "success" | "error";

const TOMORROW_ATTENDANCE_MINIMUM_THINKING_MS = 10_000;

function normalizeQuestionForIntent(question: string): string {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isTomorrowAttendanceForecastQuestion(question: string): boolean {
  const normalized = normalizeQuestionForIntent(question);
  const asksAboutTomorrow = normalized.includes("ngay mai") || normalized.includes("tomorrow");
  const asksAboutAttendance = /khach|nguoi choi|player|entry|entries|luot choi/.test(normalized);
  return asksAboutTomorrow && asksAboutAttendance;
}

function waitForMinimumThinkingWindow(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(finish, delayMs);

    function finish() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }

    function cancel() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("Request aborted", "AbortError"));
    }

    signal.addEventListener("abort", cancel, { once: true });
  });
}

const STATUS_COPY = {
  supported: "Có đủ bằng chứng trong context",
  limited: "Kết luận có giới hạn",
  blocked: "Bị chặn bởi evidence",
} as const;

const VERDICT_COPY = {
  supported: "Có thể cân nhắc",
  needs_review: "Cần xem lại",
  blocked: "Bị chặn",
  insufficient_data: "Thiếu dữ liệu",
} as const;

const PULSE_METRIC_COPY: Readonly<Record<string, string>> = Object.freeze({
  club_membership_records: "Hồ sơ trong CLB",
  club_member_profiles: "Hồ sơ trong CLB",
  club_entries_today: "Entry hôm nay",
  entries_today: "Entry hôm nay",
  club_unique_players_today: "Player unique hôm nay",
  unique_players_today: "Player unique hôm nay",
  club_active_players: "Đang chơi",
  players_playing_now: "Đang chơi",
  running_events: "Giải đang chạy",
  open_tables: "Bàn đang mở",
  dealers_on_duty: "Dealer đang trực",
});

function formatPulseValue(value: number | string | null): string {
  if (value === null) return "Chưa có";
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  if (/^\d+$/.test(value)) return new Intl.NumberFormat("vi-VN").format(BigInt(value));
  return value;
}

export function VCopilotPanel({
  ask,
  contextMode = "mock",
  clubId = null,
  clubPulse = null,
}: {
  ask?: AskV;
  contextMode?: "mock" | "live";
  clubId?: string | null;
  clubPulse?: ClubPulseV1 | null;
}) {
  const [context, setContext] = useState<SeriesCopilotContextV1 | null>(null);
  const [question, setQuestion] = useState("Lịch nào cân bằng hơn cho cuối tuần này?");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [result, setResult] = useState<AskVResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mockBaseContextRef = useRef<SeriesCopilotContextV1 | null>(null);
  const [thinkingMode, setThinkingMode] = useState<"general" | "tomorrow-attendance">("general");

  useEffect(() => {
    let active = true;
    if (contextMode === "live" && (!clubPulse || !clubId)) {
      mockBaseContextRef.current = null;
      setContext(null);
      setError("Chưa có Club Pulse đủ điều kiện để V sử dụng.");
      return () => {
        active = false;
        controllerRef.current?.abort();
      };
    }
    setError(null);
    if (contextMode === "live") {
      mockBaseContextRef.current = null;
      setContext(null);
      return () => {
        active = false;
        controllerRef.current?.abort();
      };
    }
    createMockSeriesCopilotContextV1(clubPulse ?? undefined)
      .then((next) => {
        if (active) {
          mockBaseContextRef.current = next;
          setContext(next);
        }
      })
      .catch(() => {
        if (active) {
          mockBaseContextRef.current = null;
          setError("Không thể chuẩn bị context minh họa.");
        }
      });
    return () => {
      active = false;
      controllerRef.current?.abort();
    };
  }, [clubId, clubPulse, contextMode]);

  const askV = async () => {
    const ready = contextMode === "live" ? Boolean(clubId && clubPulse) : Boolean(context);
    if (!ready || question.trim().length === 0 || requestState === "solving") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isTomorrowAttendanceForecast = isTomorrowAttendanceForecastQuestion(question);
    setThinkingMode(isTomorrowAttendanceForecast ? "tomorrow-attendance" : "general");
    setRequestState("solving");
    setResult(null);
    setError(null);
    try {
      const askImplementation: AskV = ask ?? (contextMode === "live"
        ? async (request) => {
            if (!request.clubId) throw new Error("CLUB_ID_UNAVAILABLE");
            return askSeriesCopilotEdgeV1({ untrustedQuestion: request.untrustedQuestion, clubId: request.clubId, signal: request.signal });
          }
        : async (request) => {
            if (!request.context) throw new Error("MOCK_CONTEXT_UNAVAILABLE");
            return askMockSeriesCopilotV1({ untrustedQuestion: request.untrustedQuestion, context: request.context, signal: request.signal });
          });
      const requestContext = contextMode === "mock" ? mockBaseContextRef.current ?? context : context;
      const request = askImplementation({ untrustedQuestion: question, context: requestContext, clubId, signal: controller.signal });
      const minimumThinking = isTomorrowAttendanceForecast
        ? waitForMinimumThinkingWindow(TOMORROW_ATTENDANCE_MINIMUM_THINKING_MS, controller.signal)
        : Promise.resolve();
      const [next] = await Promise.all([request, minimumThinking]);
      setContext(next.context);
      setResult(next);
      setRequestState("success");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("V tạm thời chưa thể phản hồi.");
      setRequestState("error");
    }
  };

  const response = result?.validation.response ?? null;
  const evidenceById = new Map(context?.evidence.map((item) => [item.evidenceId, item]) ?? []);
  const optionById = new Map(context?.candidateOptions.map((item) => [item.optionId, item]) ?? []);

  return (
    <section data-testid="v-copilot-panel" aria-labelledby="v-copilot-title" className="overflow-hidden rounded-md border border-primary/45 bg-card/55">
      <div className="border-b border-border/70 bg-primary/[0.045] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
              <span className="font-display text-lg font-semibold">V</span>
            </div>
            <div>
              <h2 id="v-copilot-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
                V <span className="text-muted-foreground">·</span> Series Copilot
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">So sánh phương án đã được code tạo sẵn; chủ CLB quyết định cuối cùng.</p>
            </div>
          </div>
          <Badge variant="outline" className="border-warning/35 bg-warning/10 text-warning">
            {contextMode === "live" ? "Club Pulse server · Gemini" : "Dữ liệu minh họa"}
          </Badge>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {contextMode === "mock" && <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Club Pulse minh họa">
          {(context?.clubPulse.metrics ?? []).map((metric) => (
            <div key={metric.metricId} className="min-h-20 rounded-md border border-border/70 bg-background/30 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">{PULSE_METRIC_COPY[metric.metricId] ?? metric.metricId}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{formatPulseValue(metric.value)}</p>
              <p className="text-[10px] text-muted-foreground">{metric.availability}</p>
            </div>
          ))}
          {!context && !error && <p className="text-xs text-muted-foreground">Đang chuẩn bị dữ liệu minh họa…</p>}
        </div>}

        {context && <ScheduleHealthPanel health={context.scheduleHealth} />}
        {contextMode === "live" && !context && requestState !== "solving" && !error && (
          <div role="status" className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            V sẽ đọc Club Pulse và các phương án lịch đã được owner duyệt khi bạn gửi câu hỏi.
          </div>
        )}

        <div className="space-y-2 border-t border-border/60 pt-4">
          <label htmlFor="v-owner-question" className="text-sm font-medium text-foreground">Hỏi V về lịch Series</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              id="v-owner-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1_000}
              rows={2}
              disabled={requestState === "solving"}
              className="min-h-20 resize-none"
              placeholder="Ví dụ: Phương án nào cân bằng giữa GTD, sức chứa và xung đột lịch?"
            />
            <Button onClick={askV} disabled={(contextMode === "live" ? !clubId || !clubPulse : !context) || question.trim().length === 0 || requestState === "solving"} className="h-11 gap-2 sm:w-28">
              {requestState === "solving" ? <Sparkles className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              Hỏi V
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            {contextMode === "live" ? "Gemini chỉ nhận aggregate và evidence server đã lọc; không nhận dữ liệu player thô." : "Câu hỏi là dữ liệu không tin cậy; mock không dùng nó để tạo facts mới."}
          </p>
        </div>

        {requestState === "solving" && <VThinkingIndicator mode={thinkingMode} />}

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {error}
          </div>
        )}

        {context && response && requestState === "success" && (
          <div className="space-y-4 border-t border-border/60 pt-4" data-testid="v-response">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold">
                  {response.optionAssessments.length > 0 ? "V đã tổng hợp các phương án" : "V đã kiểm tra câu hỏi"}
                </h3>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  response.answerStatus === "supported" && "border-primary/35 bg-primary/10 text-primary",
                  response.answerStatus === "limited" && "border-warning/35 bg-warning/10 text-warning",
                  response.answerStatus === "blocked" && "border-destructive/35 bg-destructive/10 text-destructive",
                )}
              >
                {STATUS_COPY[response.answerStatus]}
              </Badge>
              {result.receipt?.modelId && <Badge variant="outline" className="border-border text-muted-foreground">{result.receipt.modelId}</Badge>}
            </div>
            <p className="text-sm leading-6 text-foreground">{renderValidatedCopilotText(response.summaryVi, context)}</p>

            <div className="grid gap-3 md:grid-cols-2">
              {response.optionAssessments.map((assessment) => {
                const option = optionById.get(assessment.optionId);
                const recommended = response.recommendedOptionId === assessment.optionId;
                if (!option) return null;
                return (
                  <article key={assessment.optionId} className={cn("rounded-md border p-3", recommended ? "border-primary/40 bg-primary/[0.06]" : "border-border/70 bg-background/25")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-medium text-foreground">{option.labelVi}</h4>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{VERDICT_COPY[assessment.verdict]}</p>
                      </div>
                      {recommended && <Badge className="bg-primary/15 text-primary hover:bg-primary/15">V đang nghiêng về</Badge>}
                    </div>
                    <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                      {assessment.tradeoffs.map((tradeoff) => (
                        <li key={tradeoff} className="flex gap-2">
                          <span className="text-primary" aria-hidden>·</span>
                          <span>{renderValidatedCopilotText(tradeoff, context)}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Bằng chứng được dùng">
              <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
              {response.evidenceRefs.map((evidenceId) => (
                <span key={evidenceId} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {evidenceById.get(evidenceId)?.labelVi ?? evidenceId}
                </span>
              ))}
            </div>

            <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
              Đây là decision support. Chủ CLB vẫn phải kiểm tra cấu trúc, sức chứa và quyết định cuối cùng.
            </div>
          </div>
        )}

        {context && <DataGapPanel gaps={context.dataGaps} />}
      </div>
    </section>
  );
}
