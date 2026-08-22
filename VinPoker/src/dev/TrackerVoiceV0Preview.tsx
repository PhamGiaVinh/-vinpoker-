import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TrackerVoicePanel,
  type TrackerVoiceDiagnosticSnapshot,
} from "@/components/tracker/voice/TrackerVoicePanel";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import {
  MockRealtimeTranscriptionProvider,
  createTrackerVoiceOpenAiProvider,
  type TrackerVoiceRuntimeContext,
  type ValidateVoiceEventInput,
  type ValidatedVoiceEventReceipt,
  type VoiceActionMetadata,
  type VoiceActionProposal,
} from "@/lib/trackerVoice";

const TOURNAMENT_ID = "71000000-0000-4000-8000-000000000001";
const TABLE_ID = "72000000-0000-4000-8000-000000000001";
const HAND_ID = "73000000-0000-4000-8000-000000000001";
const STATE_VERSION = "a".repeat(64);

const READY_RUNTIME: TrackerVoiceRuntimeContext = {
  ok: true,
  can_mint_session: true,
  read_only: false,
  correction_pending: false,
  config: {
    enabled: true,
    configured_mode: "assist",
    provider_model: "gpt-live-transcribe",
    spoken_amount_unit: 1,
    amount_unit_confirmed: false,
    provider_confidence_threshold: null,
    server_auto_allowed: false,
    correction_state: "ready",
  },
  active_hand: { hand_id: HAND_ID, hand_number: 12, status: "in_progress", state_version: STATE_VERSION },
};

interface PreviewAction {
  idempotencyKey: string;
  action: string;
  amount: number | null;
}

interface VoiceUatMeasurement {
  providerEventId: string;
  transcript: string;
  capturedAt: string;
  transcriptLatencyMs: number | null;
  proposalLatencyMs: number | null;
  command: string | null;
  amount: number | null;
  amountAmbiguous: boolean | null;
  result: "pending" | "correct" | "incorrect";
  expected: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function downloadArtifact(name: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function csvValue(value: unknown): string {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function snapshotCommand(snapshot: TrackerVoiceDiagnosticSnapshot | null): string | null {
  if (!snapshot?.proposal?.ok) return null;
  return "controlAction" in snapshot.proposal
    ? snapshot.proposal.controlAction
    : snapshot.proposal.canonicalAction;
}

export default function TrackerVoiceV0Preview() {
  const [providerKind, setProviderKind] = useState<"mock" | "openai">("mock");
  const [snapshot, setSnapshot] = useState<TrackerVoiceDiagnosticSnapshot | null>(null);
  const [actions, setActions] = useState<PreviewAction[]>([]);
  const [validationCount, setValidationCount] = useState(0);
  const [floorAlertCount, setFloorAlertCount] = useState(0);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [expected, setExpected] = useState("");
  const [pendingUtteranceAt, setPendingUtteranceAt] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<VoiceUatMeasurement[]>([]);
  const [connectionDrops, setConnectionDrops] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const [deviceChanges, setDeviceChanges] = useState(0);
  const processedFinalRef = useRef<string | null>(null);
  const previousStatusRef = useRef<TrackerVoiceDiagnosticSnapshot["status"] | null>(null);
  const previousDeviceIdRef = useRef<string | null>(null);
  const sessionRunningRef = useRef(false);
  const reconnectPendingRef = useRef(false);

  const provider = useMemo(() => providerKind === "mock"
    ? new MockRealtimeTranscriptionProvider()
    : createTrackerVoiceOpenAiProvider(TOURNAMENT_ID, TABLE_ID), [providerKind]);

  const validateEvent = useCallback(async (input: ValidateVoiceEventInput): Promise<ValidatedVoiceEventReceipt> => {
    setValidationCount((current) => current + 1);
    const wrongAction = input.finalTranscript.toLocaleLowerCase("vi-VN").includes("sai action");
    if (wrongAction) setFloorAlertCount((current) => current + 1);
    return {
      ok: true,
      voice_event_id: crypto.randomUUID(),
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      state_version: input.expectedStateVersion,
      execution_mode: input.executionMode,
      execution_result: wrongAction ? "alert_opened" : "validated",
      correction_pending: wrongAction,
      alert_id: wrongAction ? crypto.randomUUID() : null,
    };
  }, []);

  const handleVoiceAction = useCallback(async (
    proposal: VoiceActionProposal,
    metadata: VoiceActionMetadata,
  ): Promise<boolean> => {
    setActions((current) => current.some((item) => item.idempotencyKey === metadata.idempotencyKey)
      ? current
      : [...current, {
          idempotencyKey: metadata.idempotencyKey,
          action: proposal.canonicalAction,
          amount: proposal.betToTotal ?? null,
        }]);
    return true;
  }, []);

  const hook = useMemo(() => ({
    tournamentId: TOURNAMENT_ID,
    tableId: TABLE_ID,
    handId: HAND_ID,
    currentStreet: "flop",
    actorPlayer: {
      player_id: "74000000-0000-4000-8000-000000000001",
      display_name: "Player A",
      seat_number: 3,
      current_stack: 30_000,
      current_bet: 1_000,
    },
    actorViewData: {
      toCall: 1_000,
      minRaiseTo: 4_000,
      legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
    },
    handStarted: true,
    showActionStep: true,
    isReadOnly: false,
    actionSyncBlocked: false,
    handleVoiceAction,
  }) as unknown as StandaloneHandInput, [handleVoiceAction]);

  useEffect(() => {
    sessionRunningRef.current = sessionRunning;
  }, [sessionRunning]);

  const onSnapshot = useCallback((next: TrackerVoiceDiagnosticSnapshot) => {
    const previousStatus = previousStatusRef.current;
    const disconnected = next.status === "offline" || next.status === "recovering" || next.status === "error";
    const wasDisconnected = previousStatus === "offline" || previousStatus === "recovering" || previousStatus === "error";

    if (sessionRunningRef.current && previousStatus !== next.status && disconnected) {
      setConnectionDrops((current) => current + 1);
      reconnectPendingRef.current = true;
    }
    if (sessionRunningRef.current && previousStatus !== next.status && next.status === "listening" && (wasDisconnected || reconnectPendingRef.current)) {
      setReconnects((current) => current + 1);
      reconnectPendingRef.current = false;
    }

    const deviceId = next.inputDevice?.deviceId ?? null;
    if (sessionRunningRef.current && previousDeviceIdRef.current !== null && deviceId !== null && previousDeviceIdRef.current !== deviceId) {
      setDeviceChanges((current) => current + 1);
    }

    previousStatusRef.current = next.status;
    if (deviceId !== null) previousDeviceIdRef.current = deviceId;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    const providerEventId = snapshot?.finalProviderEventId;
    if (!sessionRunning || !providerEventId || processedFinalRef.current === providerEventId) return;
    processedFinalRef.current = providerEventId;
    const command = snapshotCommand(snapshot);
    const amount = snapshot?.proposal?.ok && "canonicalAction" in snapshot.proposal
      ? snapshot.proposal.betToTotal ?? null
      : null;
    const amountAmbiguous = snapshot?.proposal?.command?.amount?.ambiguous ?? null;
    setMeasurements((current) => [...current, {
      providerEventId,
      transcript: snapshot.finalTranscript,
      capturedAt: snapshot.finalCapturedAt ?? new Date().toISOString(),
      transcriptLatencyMs: pendingUtteranceAt === null ? null : Math.max(0, performance.now() - pendingUtteranceAt),
      proposalLatencyMs: snapshot.proposalLatencyMs,
      command,
      amount,
      amountAmbiguous,
      result: "pending",
      expected,
    }]);
    setPendingUtteranceAt(null);
  }, [expected, pendingUtteranceAt, sessionRunning, snapshot]);

  const finalLatencies = measurements.flatMap((item) => item.transcriptLatencyMs === null ? [] : [item.transcriptLatencyMs]);
  const exactMatches = measurements.filter((item) => item.result === "correct").length;
  const permission = snapshot?.status === "listening" ? "granted" : snapshot?.status === "requesting_permission" ? "pending" : "unknown";

  const markLatest = (result: "correct" | "incorrect") => {
    setMeasurements((current) => current.map((item, index) => index === current.length - 1 ? { ...item, result, expected } : item));
  };

  const startSession = () => {
    processedFinalRef.current = null;
    setMeasurements([]);
    setConnectionDrops(0);
    setReconnects(0);
    setDeviceChanges(0);
    previousStatusRef.current = snapshot?.status ?? null;
    previousDeviceIdRef.current = snapshot?.inputDevice?.deviceId ?? null;
    reconnectPendingRef.current = false;
    setExpected("");
    setPendingUtteranceAt(null);
    setSessionRunning(true);
  };

  const emitDuplicateProviderCallback = () => {
    if (!(provider instanceof MockRealtimeTranscriptionProvider)) return;
    provider.emit("call", { final: true, id: "duplicate-provider-item" });
    provider.emit("call", { final: true, id: "duplicate-provider-item" });
  };

  const exportJson = () => downloadArtifact("tracker-voice-uat.json", JSON.stringify({
    generatedAt: new Date().toISOString(),
    provider: providerKind,
    measurements,
    connectionDrops,
    reconnects,
    deviceChanges,
  }, null, 2), "application/json");

  const exportCsv = () => downloadArtifact("tracker-voice-uat.csv", [
    ["providerEventId", "transcript", "capturedAt", "transcriptLatencyMs", "proposalLatencyMs", "command", "amount", "amountAmbiguous", "result", "expected"].join(","),
    ...measurements.map((item) => [
      item.providerEventId, item.transcript, item.capturedAt, item.transcriptLatencyMs, item.proposalLatencyMs,
      item.command, item.amount, item.amountAmbiguous, item.result, item.expected,
    ].map(csvValue).join(",")),
  ].join("\n"), "text/csv;charset=utf-8");

  return (
    <main className="min-h-screen bg-[#070a0c] p-3 text-zinc-100 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-emerald-300/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,.15),transparent_36%),rgba(10,13,16,.92)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">DEV ONLY · Non-production Voice UAT</p>
          <h1 className="mt-1 text-xl font-black">Tracker Voice recognition diagnostic</h1>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400">Chỉ final transcript mới tạo Shadow proposal. Mock chứng minh UI/parser; OpenAI Realtime cần session endpoint và secret cục bộ, không có fallback bí mật.</p>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(340px,.82fr)]">
          <TrackerVoicePanel
            key={providerKind}
            hook={hook}
            providerOverride={provider}
            runtimeOverride={READY_RUNTIME}
            validateEventOverride={validateEvent}
            onDiagnosticSnapshot={onSnapshot}
          />

          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="Voice UAT controls">
              <h2 className="font-bold">Provider và phiên đo</h2>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Provider">
                {(["mock", "openai"] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setProviderKind(item)} className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${providerKind === item ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100" : "border-white/10 bg-black/20 text-zinc-400"}`}>
                    {item === "mock" ? "Mock" : "OpenAI Realtime"}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">OpenAI selection only attempts the local `tracker-voice-session` endpoint after mic connect. It never embeds or displays a credential.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={startSession} className="min-h-11 rounded-xl bg-emerald-300 px-3 text-xs font-black text-emerald-950">Bắt đầu phiên test</button>
                <button type="button" onClick={() => setSessionRunning(false)} className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-xs font-bold text-zinc-200">Dừng phiên test</button>
                <button type="button" onClick={() => setPendingUtteranceAt(performance.now())} disabled={!sessionRunning} className="min-h-11 rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 text-xs font-bold text-sky-100 disabled:opacity-35">Đánh dấu bắt đầu câu</button>
                <input aria-label="Nhập kết quả mong đợi" value={expected} onChange={(event) => setExpected(event.target.value)} placeholder="Kết quả mong đợi" className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" />
                <button type="button" onClick={() => markLatest("correct")} disabled={measurements.length === 0} className="min-h-11 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 text-xs font-bold text-emerald-100 disabled:opacity-35">Đánh dấu đúng</button>
                <button type="button" onClick={() => markLatest("incorrect")} disabled={measurements.length === 0} className="min-h-11 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 text-xs font-bold text-rose-100 disabled:opacity-35">Đánh dấu sai</button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={exportJson} disabled={measurements.length === 0} className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-zinc-200 disabled:opacity-35">Xuất JSON</button>
                <button type="button" onClick={exportCsv} disabled={measurements.length === 0} className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-zinc-200 disabled:opacity-35">Xuất CSV</button>
              </div>
              {providerKind === "mock" && (
                <button type="button" onClick={emitDuplicateProviderCallback} className="mt-2 min-h-11 w-full rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 text-xs font-bold text-amber-100">
                  Phát duplicate provider callback
                </button>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-black/20 p-4" aria-label="Live Voice diagnostic">
              <h2 className="font-bold">Tín hiệu hiện tại</h2>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Provider</dt><dd>{providerKind === "mock" ? "Mock" : "OpenAI Realtime"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Mic permission</dt><dd>{permission}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Input device</dt><dd className="max-w-[58%] truncate text-right">{snapshot?.inputDevice?.label ?? "—"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Connection</dt><dd>{snapshot?.status ?? "idle"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">RMS</dt><dd>{Math.round((snapshot?.rms ?? 0) * 100)}%</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Actor / legal</dt><dd className="text-right">Player A · call / raise / all-in</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-zinc-500">Provider event</dt><dd className="max-w-[58%] truncate text-right font-mono text-[10px]">{snapshot?.finalProviderEventId ?? "—"}</dd></div>
              </dl>
              <div className="mt-4 space-y-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-xs">
                <p><span className="text-zinc-500">Partial:</span> {snapshot?.partialTranscript || "—"}</p>
                <p><span className="text-zinc-500">Final:</span> {snapshot?.finalTranscript || "—"}</p>
                <p><span className="text-zinc-500">Parsed:</span> {snapshotCommand(snapshot) ?? snapshot?.validationError ?? "—"}</p>
                <p><span className="text-zinc-500">Amount:</span> {snapshot?.proposal?.ok && "canonicalAction" in snapshot.proposal ? snapshot.proposal.betToTotal?.toLocaleString("vi-VN") ?? "—" : "—"}</p>
                <p><span className="text-zinc-500">Proposal latency:</span> {snapshot?.proposalLatencyMs === null || snapshot?.proposalLatencyMs === undefined ? "—" : `${Math.round(snapshot.proposalLatencyMs)} ms`}</p>
              </div>
            </section>

            <section className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.04] p-4" aria-label="Assist fixture receipt">
              <h2 className="font-bold text-sky-100">Assist fixture receipt</h2>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="text-zinc-500">Validated</div><strong data-testid="validation-count" className="text-lg text-sky-100">{validationCount}</strong></div>
                <div><div className="text-zinc-500">Committed</div><strong data-testid="canonical-action-count" className="text-lg text-emerald-300">{actions.length}</strong></div>
                <div><div className="text-zinc-500">Floor alerts</div><strong data-testid="floor-alert-count" className="text-lg text-amber-200">{floorAlertCount}</strong></div>
              </div>
              {actions.length === 0 ? (
                <p className="mt-3 text-xs text-zinc-500">Shadow không tạo receipt hoặc action. Assist cần xác nhận thủ công.</p>
              ) : (
                <ol className="mt-3 space-y-2" data-testid="viewer-replay-actions">
                  {actions.map((action, index) => (
                    <li key={action.idempotencyKey} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs">
                      #{index + 1} · Player A · {action.action}{action.amount === null ? "" : ` tới ${action.amount.toLocaleString("vi-VN")}`}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4" aria-label="Voice UAT measurements">
              <h2 className="font-bold text-amber-100">Kết quả đo phiên này</h2>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="text-zinc-500">Final</div><strong data-testid="final-count" className="text-lg">{measurements.length}</strong></div>
                <div><div className="text-zinc-500">Đúng</div><strong data-testid="exact-match-count" className="text-lg text-emerald-300">{exactMatches}</strong></div>
                <div><div className="text-zinc-500">Median</div><strong data-testid="median-latency" className="text-lg">{median(finalLatencies) === null ? "—" : `${Math.round(median(finalLatencies) ?? 0)}ms`}</strong></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="text-zinc-500">Rớt kết nối</div><strong data-testid="connection-drop-count">{connectionDrops}</strong></div>
                <div><div className="text-zinc-500">Kết nối lại</div><strong data-testid="reconnect-count">{reconnects}</strong></div>
                <div><div className="text-zinc-500">Đổi thiết bị</div><strong data-testid="device-change-count">{deviceChanges}</strong></div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-amber-100/75">Để đo latency thật, bấm “Đánh dấu bắt đầu câu” ngay trước khi nói. Nếu không đánh dấu, transcript vẫn được ghi nhưng latency là chưa đo được.</p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
