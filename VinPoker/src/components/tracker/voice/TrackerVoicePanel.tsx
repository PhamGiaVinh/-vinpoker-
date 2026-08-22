import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Headphones, Loader2, Mic, MicOff, Radio, RotateCcw, ShieldCheck } from "lucide-react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { FEATURES } from "@/lib/featureFlags";
import {
  loadTrackerVoiceRuntimeContext,
  createTrackerVoiceOpenAiProvider,
  MockRealtimeTranscriptionProvider,
  parseVoiceCommand,
  resolveVoiceProposal,
  validateTrackerVoiceEvent,
  type RealtimeTranscriptionProvider,
  type TrackerVoiceRuntimeContext,
  type ValidateVoiceEventInput,
  type ValidatedVoiceEventReceipt,
  type VoiceExecutionMode,
  type VoiceActionProposal,
  type VoiceProposal,
  type VoiceProviderStatus,
  type VoiceTranscriptEvent,
} from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";

interface TrackerVoicePanelProps {
  hook: StandaloneHandInput;
  providerOverride?: RealtimeTranscriptionProvider;
  runtimeOverride?: TrackerVoiceRuntimeContext;
  validateEventOverride?: (input: ValidateVoiceEventInput) => Promise<ValidatedVoiceEventReceipt>;
  spokenAmountUnit?: number;
  amountUnitConfirmed?: boolean;
  onDiagnosticSnapshot?: (snapshot: TrackerVoiceDiagnosticSnapshot) => void;
}

export interface TrackerVoiceDiagnosticSnapshot {
  provider: "mock" | "openai_realtime" | null;
  status: VoiceProviderStatus;
  statusMessage: string | null;
  inputDevice: { deviceId: string | null; label: string | null } | null;
  rms: number;
  partialTranscript: string;
  finalTranscript: string;
  finalProviderEventId: string | null;
  finalCapturedAt: string | null;
  proposal: VoiceProposal | null;
  proposalLatencyMs: number | null;
  validationState: "idle" | "validating" | "validated" | "committing" | "committed" | "error";
  validationError: string | null;
}

interface VoiceEventAttempt {
  attemptId: string;
  event: VoiceTranscriptEvent;
  runtimeSnapshot: TrackerVoiceRuntimeContext | null;
  executionMode?: VoiceExecutionMode;
}

export const MIC_TEST_DURATION_MS = 30_000;
const MAX_BUFFERED_TRANSCRIPTS = 20;

function createDefaultProvider(hook: StandaloneHandInput): RealtimeTranscriptionProvider {
  if (import.meta.env.VITE_TRACKER_VOICE_PROVIDER === "mock") {
    return new MockRealtimeTranscriptionProvider();
  }
  return createTrackerVoiceOpenAiProvider(hook.tournamentId, hook.tableId);
}

function proposalTone(proposal: VoiceProposal | null): string {
  if (!proposal) return "border-white/10 bg-black/20 text-zinc-400";
  return proposal.ok
    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
    : "border-amber-400/35 bg-amber-400/10 text-amber-100";
}

export function TrackerVoicePanel({
  hook,
  providerOverride,
  runtimeOverride,
  validateEventOverride = validateTrackerVoiceEvent,
  spokenAmountUnit = 1,
  amountUnitConfirmed = false,
  onDiagnosticSnapshot,
}: TrackerVoicePanelProps) {
  const providerRef = useRef<RealtimeTranscriptionProvider | null>(providerOverride ?? null);
  const [status, setStatus] = useState<VoiceProviderStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [mode, setMode] = useState<VoiceExecutionMode>("shadow");
  const [mockText, setMockText] = useState("raise 120k");
  const [providerConfidence, setProviderConfidence] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [inputDevice, setInputDevice] = useState<{ deviceId: string | null; label: string | null } | null>(null);
  const [lastFinalProviderEventId, setLastFinalProviderEventId] = useState<string | null>(null);
  const [lastFinalCapturedAt, setLastFinalCapturedAt] = useState<string | null>(null);
  const [proposalLatencyMs, setProposalLatencyMs] = useState<number | null>(null);
  const [micTestStartedAt, setMicTestStartedAt] = useState<number | null>(null);
  const [micTestElapsedMs, setMicTestElapsedMs] = useState(0);
  const [micTestResult, setMicTestResult] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<TrackerVoiceRuntimeContext | null>(runtimeOverride ?? null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<"idle" | "validating" | "validated" | "committing" | "committed" | "error">("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedReceipt, setValidatedReceipt] = useState<ValidatedVoiceEventReceipt | null>(null);
  const [validatedProposal, setValidatedProposal] = useState<VoiceProposal | null>(null);
  const [finalAttempt, setFinalAttempt] = useState<VoiceEventAttempt | null>(null);
  const [bufferedEvents, setBufferedEvents] = useState<VoiceTranscriptEvent[]>([]);
  const [bufferStatus, setBufferStatus] = useState<string | null>(null);
  const validationGenerationRef = useRef(0);
  const validationPromisesRef = useRef(new Map<string, Promise<ValidatedVoiceEventReceipt>>());
  const requestIdentitiesRef = useRef(new Map<string, { idempotencyKey: string; traceId: string }>());
  const micTestMaxLevelRef = useRef(0);
  const micTestFinalCountRef = useRef(0);
  const micTestActiveRef = useRef(false);
  const statusRef = useRef<VoiceProviderStatus>("idle");
  const runtimeRef = useRef<TrackerVoiceRuntimeContext | null>(runtimeOverride ?? null);
  const processedAttemptIdsRef = useRef(new Set<string>());
  const finalReceivedAtRef = useRef(new Map<string, number>());

  useWakeLock(status === "listening");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const proposalContext = useMemo(
    () => ({
      handId: hook.handId,
      street: hook.currentStreet,
      expectedStateVersion: runtime?.active_hand?.hand_id === hook.handId
        ? runtime.active_hand.state_version
        : null,
      actor: hook.actorPlayer
        ? {
            playerId: hook.actorPlayer.player_id,
            playerName: hook.actorPlayer.display_name,
            seatNumber: hook.actorPlayer.seat_number,
            currentStack: hook.actorPlayer.current_stack,
            currentBet: hook.actorPlayer.current_bet,
          }
        : null,
      actorView: hook.actorViewData
        ? {
            toCall: hook.actorViewData.toCall,
            minRaiseTo: hook.actorViewData.minRaiseTo,
            legal: hook.actorViewData.legal,
          }
        : null,
      handStarted: hook.handStarted,
      actionStepActive: hook.showActionStep,
      readOnly: hook.isReadOnly,
      syncBlocked: hook.actionSyncBlocked,
      correctionPending: runtime?.correction_pending ?? false,
    }),
    [
      hook.actionSyncBlocked,
      hook.actorPlayer,
      hook.actorViewData,
      hook.currentStreet,
      hook.handId,
      hook.handStarted,
      hook.isReadOnly,
      hook.showActionStep,
      runtime?.active_hand?.hand_id,
      runtime?.active_hand?.state_version,
      runtime?.correction_pending,
    ],
  );

  const refreshRuntime = useCallback(async () => {
    if (runtimeOverride) {
      setRuntime(runtimeOverride);
      setRuntimeError(null);
      return runtimeOverride;
    }
    try {
      const next = await loadTrackerVoiceRuntimeContext(hook.tournamentId, hook.tableId);
      setRuntime(next);
      setRuntimeError(null);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tải được quyền Voice.";
      setRuntime(null);
      setRuntimeError(message);
      return null;
    }
  }, [hook.tableId, hook.tournamentId, runtimeOverride]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    validationGenerationRef.current += 1;
    setFinalAttempt(null);
    setFinalTranscript("");
    setProposal(null);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationState("idle");
    setValidationError(null);
    setBufferedEvents([]);
    setBufferStatus(null);
    processedAttemptIdsRef.current.clear();
    validationPromisesRef.current.clear();
    requestIdentitiesRef.current.clear();
    finalReceivedAtRef.current.clear();
    setInputDevice(null);
    setLastFinalProviderEventId(null);
    setLastFinalCapturedAt(null);
    setProposalLatencyMs(null);
  }, [hook.handId]);

  useEffect(() => {
    onDiagnosticSnapshot?.({
      provider: providerRef.current?.kind ?? null,
      status,
      statusMessage,
      inputDevice,
      rms: audioLevel,
      partialTranscript: partial,
      finalTranscript,
      finalProviderEventId: lastFinalProviderEventId,
      finalCapturedAt: lastFinalCapturedAt,
      proposal,
      proposalLatencyMs,
      validationState,
      validationError,
    });
  }, [
    audioLevel,
    finalTranscript,
    inputDevice,
    lastFinalCapturedAt,
    lastFinalProviderEventId,
    onDiagnosticSnapshot,
    partial,
    proposal,
    proposalLatencyMs,
    status,
    statusMessage,
    validationError,
    validationState,
  ]);

  useEffect(() => {
    if (!finalAttempt || processedAttemptIdsRef.current.has(finalAttempt.attemptId)) return;
    processedAttemptIdsRef.current.add(finalAttempt.attemptId);
    const finalEvent = finalAttempt.event;
    const attemptRuntime = finalAttempt.runtimeSnapshot ?? runtime;
    const attemptMode = finalAttempt.executionMode ?? mode;
    const unit = attemptRuntime?.config.spoken_amount_unit ?? spokenAmountUnit;
    const unitConfirmed = attemptRuntime?.config.amount_unit_confirmed ?? amountUnitConfirmed;
    const command = parseVoiceCommand(finalEvent.transcript, {
      spokenAmountUnit: unit,
      amountUnitConfirmed: unitConfirmed,
    });
    const nextProposal = resolveVoiceProposal(command, {
      ...proposalContext,
      expectedStateVersion: attemptRuntime?.active_hand?.hand_id === hook.handId
        ? attemptRuntime.active_hand.state_version
        : null,
      correctionPending: attemptRuntime?.correction_pending ?? false,
    });
    const receivedAt = finalReceivedAtRef.current.get(finalEvent.providerEventId);
    setProposalLatencyMs(receivedAt === undefined ? null : Math.max(0, performance.now() - receivedAt));
    setProposal(nextProposal);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationError(null);
    if (!nextProposal.ok) {
      setValidationState("idle");
      return;
    }
    const activeHand = attemptRuntime?.active_hand;
    if (!attemptRuntime?.can_mint_session || !activeHand || activeHand.hand_id !== hook.handId) {
      setValidationState("error");
      setValidationError(runtimeError ?? "Voice chưa có assignment hoặc active hand hợp lệ.");
      return;
    }

    // Poker commands stay local in Shadow. Control commands intentionally go
    // through the existing alert path, which never records a poker action.
    const requiresServerValidation = attemptMode !== "shadow" || "controlAction" in nextProposal;
    if (!requiresServerValidation) {
      setValidatedProposal(nextProposal);
      setValidationState("validated");
      return;
    }

    let identity = requestIdentitiesRef.current.get(finalEvent.providerEventId);
    if (!identity) {
      identity = {
        idempotencyKey: `voice:${crypto.randomUUID()}`,
        traceId: `voice-trace:${crypto.randomUUID()}`,
      };
      requestIdentitiesRef.current.set(finalEvent.providerEventId, identity);
    }
    const generation = ++validationGenerationRef.current;
    const input: ValidateVoiceEventInput = {
      tournamentId: hook.tournamentId,
      tournamentTableId: hook.tableId,
      handId: activeHand.hand_id,
      finalTranscript: finalEvent.transcript,
      providerName: providerRef.current?.kind ?? "openai_realtime",
      providerModel: attemptRuntime.config.provider_model,
      providerEventId: finalEvent.providerEventId,
      ...(finalEvent.providerConfidence === undefined
        ? {}
        : { providerConfidence: finalEvent.providerConfidence }),
      executionMode: attemptMode,
      expectedStateVersion: activeHand.state_version,
      ...identity,
    };
    let pending = validationPromisesRef.current.get(finalEvent.providerEventId);
    if (!pending) {
      pending = validateEventOverride(input);
      validationPromisesRef.current.set(finalEvent.providerEventId, pending);
    }
    setValidationState("validating");
    void pending.then((receipt) => {
      if (validationGenerationRef.current !== generation) return;
      setValidatedReceipt(receipt);
      setValidatedProposal(nextProposal);
      setValidationState("validated");
      if (receipt.correction_pending) {
        setRuntime((current) => current && !current.correction_pending
          ? { ...current, correction_pending: true }
          : current);
      }
    }).catch((error) => {
      if (validationGenerationRef.current !== generation) return;
      setValidationState("error");
      setValidationError(error instanceof Error ? error.message : "Voice validation thất bại.");
    });
  }, [
    amountUnitConfirmed,
    finalAttempt,
    hook.handId,
    hook.tableId,
    hook.tournamentId,
    mode,
    proposalContext,
    runtime,
    runtimeError,
    spokenAmountUnit,
    validateEventOverride,
  ]);

  useEffect(() => () => {
    void providerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (micTestStartedAt === null) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - micTestStartedAt;
      setMicTestElapsedMs(Math.min(MIC_TEST_DURATION_MS, elapsed));
      if (elapsed < MIC_TEST_DURATION_MS) return;
      window.clearInterval(timer);
      micTestActiveRef.current = false;
      setMicTestStartedAt(null);
      if (micTestMaxLevelRef.current < 0.015) {
        setMicTestResult("Không nhận được âm thanh. Kiểm tra quyền mic hoặc chọn lại thiết bị.");
      } else if (micTestFinalCountRef.current === 0) {
        setMicTestResult("Mic có tín hiệu nhưng chưa nhận final transcript. Hãy thử nói rõ một action.");
      } else {
        setMicTestResult(`Mic ổn định · ${micTestFinalCountRef.current} final transcript trong 30 giây.`);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [micTestStartedAt]);

  useEffect(() => {
    const handleOffline = () => {
      if (statusRef.current === "idle") return;
      setStatus("offline");
      setStatusMessage("Thiết bị mất mạng. Voice đã dừng ghi action.");
    };
    const handleDeviceChange = () => {
      if (statusRef.current === "idle") return;
      setStatus("recovering");
      setStatusMessage("Danh sách microphone vừa thay đổi. Hãy kết nối lại để xác nhận đúng thiết bị.");
    };
    window.addEventListener("offline", handleOffline);
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      window.removeEventListener("offline", handleOffline);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  const connect = async () => {
    const currentRuntime = runtime ?? await refreshRuntime();
    if (!currentRuntime?.can_mint_session) {
      setStatus("error");
      setStatusMessage(runtimeError ?? "Dealer chưa có đúng một assignment hoặc Voice chưa được bật.");
      return;
    }
    const provider = providerRef.current ?? createDefaultProvider(hook);
    providerRef.current = provider;
    setAudioLevel(0);
    setStatusMessage(null);
    try {
      await provider.connect({
        onStatus: (next, message) => {
          setStatus(next);
          setStatusMessage(message ?? null);
        },
        onTranscript: (event) => {
          if (!event.isFinal) {
            setPartial(event.transcript);
            return;
          }
          setPartial("");
          setFinalTranscript(event.transcript);
          setLastFinalProviderEventId(event.providerEventId);
          setLastFinalCapturedAt(event.capturedAt);
          finalReceivedAtRef.current.set(event.providerEventId, performance.now());
          setProviderConfidence(event.providerConfidence ?? null);
          if (micTestActiveRef.current) micTestFinalCountRef.current += 1;
          if (runtimeRef.current?.correction_pending) {
            setBufferedEvents((current) => {
              if (current.some((candidate) => candidate.providerEventId === event.providerEventId)) {
                return current;
              }
              return [...current, event].slice(-MAX_BUFFERED_TRANSCRIPTS);
            });
            setBufferStatus("Transcript được giữ cục bộ. Voice sẽ không ghi action khi Floor chưa sửa xong.");
            return;
          }
          setFinalAttempt({
            attemptId: `provider:${event.providerEventId}`,
            event,
            runtimeSnapshot: runtimeRef.current,
          });
        },
        onLevel: (rms) => {
          const normalized = Math.max(0, Math.min(1, rms));
          setAudioLevel(normalized);
          if (micTestActiveRef.current) micTestMaxLevelRef.current = Math.max(micTestMaxLevelRef.current, normalized);
        },
        onInputDevice: setInputDevice,
      });
    } catch (error) {
      await provider.disconnect().catch(() => undefined);
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Không mở được microphone.");
    }
  };

  const disconnect = async () => {
    await providerRef.current?.disconnect();
    setStatus("idle");
    setAudioLevel(0);
    setPartial("");
    micTestActiveRef.current = false;
    setMicTestStartedAt(null);
  };

  const reconnect = async () => {
    await disconnect();
    await connect();
  };

  const startMicTest = () => {
    if (status !== "listening") return;
    micTestMaxLevelRef.current = 0;
    micTestFinalCountRef.current = 0;
    micTestActiveRef.current = true;
    setMicTestElapsedMs(0);
    setMicTestResult(null);
    setMicTestStartedAt(Date.now());
  };

  const emitMock = () => {
    const provider = providerRef.current;
    if (!(provider instanceof MockRealtimeTranscriptionProvider)) return;
    provider.emit(mockText, { final: true });
  };

  const revalidateBufferedEvent = async () => {
    const nextRuntime = await refreshRuntime();
    if (!nextRuntime || nextRuntime.correction_pending) {
      setBufferStatus("Floor chưa hoàn tất correction. Transcript vẫn được giữ và không ghi action.");
      return;
    }
    const [nextEvent, ...remaining] = bufferedEvents;
    if (!nextEvent) return;
    setBufferedEvents(remaining);
    setBufferStatus(remaining.length > 0 ? `Còn ${remaining.length} transcript chờ xác nhận Assist.` : null);
    setMode("assist");
    setFinalTranscript(nextEvent.transcript);
    setProviderConfidence(nextEvent.providerConfidence ?? null);
    requestIdentitiesRef.current.delete(nextEvent.providerEventId);
    setFinalAttempt({
      attemptId: `revalidate:${crypto.randomUUID()}`,
      event: { ...nextEvent },
      runtimeSnapshot: nextRuntime,
      executionMode: "assist",
    });
  };

  const assistAllowed = runtime?.config.configured_mode === "assist" || runtime?.config.configured_mode === "auto";
  const autoAllowed = Boolean(
    FEATURES.trackerVoiceAutoCommit
    && runtime?.config.configured_mode === "auto"
    && runtime.config.server_auto_allowed
    && runtime.config.provider_confidence_threshold !== null
    && providerConfidence !== null,
  );

  const confirmAssist = async () => {
    if (
      validationState !== "validated"
      || !validatedReceipt
      || !validatedProposal?.ok
      || !("canonicalAction" in validatedProposal)
    ) return;
    setValidationState("committing");
    setValidationError(null);
    const actionProposal = validatedProposal as VoiceActionProposal;
    const committed = await hook.handleVoiceAction(actionProposal, {
      source: "voice",
      tournamentTableId: hook.tableId,
      voiceEventId: validatedReceipt.voice_event_id,
      idempotencyKey: validatedReceipt.idempotency_key,
      traceId: validatedReceipt.trace_id,
      expectedStateVersion: validatedReceipt.state_version,
    });
    if (!committed) {
      setValidationState("error");
      setValidationError("Action không được canonical writer xác nhận. Hãy tải lại trạng thái bàn.");
      return;
    }
    setValidationState("committed");
    await refreshRuntime();
  };

  const proposalLabel = proposal?.ok
    ? "controlAction" in proposal
      ? proposal.controlAction === "call_floor" ? "Gọi Floor" : "Báo sai action"
      : `${proposal.actor.playerName} · ${proposal.canonicalAction}${proposal.betToTotal ? ` tới ${proposal.betToTotal.toLocaleString("vi-VN")}` : ""}`
    : proposal?.message ?? "Nói một lệnh để tạo đề xuất Shadow.";

  const providerKind = providerRef.current?.kind ??
    (import.meta.env.VITE_TRACKER_VOICE_PROVIDER === "mock" ? "mock" : "openai_realtime");

  return (
    <section
      className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-[linear-gradient(135deg,rgba(5,18,14,.95),rgba(8,10,13,.96))] shadow-[0_18px_50px_rgba(0,0,0,.28)]"
      aria-label="Voice Tracker"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-300">
            <Radio className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-100">Voice Tracker</h2>
            <p className="truncate text-[11px] text-zinc-500">
              {providerKind === "mock" ? "Mock mic · Preview" : "OpenAI Realtime · Dealer assignment bắt buộc"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={status === "listening" ? disconnect : connect}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 text-xs font-semibold text-emerald-200 outline-none transition hover:bg-emerald-300/15 focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          {status === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {status === "listening" ? "Ngắt mic" : "Kết nối mic"}
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2" aria-label="Chế độ Voice">
          {(["shadow", "assist", "auto"] as const).map((item) => {
            const unavailable = item === "assist" ? !assistAllowed : item === "auto" ? !autoAllowed : false;
            return (
              <button
                key={item}
                type="button"
                disabled={unavailable}
                onClick={() => setMode(item)}
                className={`min-h-11 rounded-xl border px-2 text-[11px] font-semibold uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-35 ${
                  mode === item
                    ? "border-emerald-300/45 bg-emerald-300/15 text-emerald-200"
                    : "border-white/10 bg-white/[0.03] text-zinc-400"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-white/8 bg-black/25 px-3">
          <span className={`h-2.5 w-2.5 rounded-full ${status === "listening" ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.8)]" : "bg-zinc-600"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-200">{status === "listening" ? "Đang nghe" : "Microphone chưa hoạt động"}</div>
            <div className="truncate text-[11px] text-zinc-500">{statusMessage ?? (partial || "Final transcript mới được phân tích.")}</div>
          </div>
          <Headphones className="h-4 w-4 text-zinc-600" />
        </div>

        <div className="rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-semibold text-zinc-300">Tín hiệu microphone</span>
            <span className="font-mono text-zinc-500">{Math.round(audioLevel * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/7" aria-label="Mức tín hiệu microphone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(audioLevel * 100)} role="meter">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-300 to-amber-300 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(2, audioLevel * 100)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={status !== "listening" || micTestStartedAt !== null}
              onClick={startMicTest}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-35"
            >
              {micTestStartedAt === null ? "Kiểm tra mic 30 giây" : `Đang test ${Math.ceil((MIC_TEST_DURATION_MS - micTestElapsedMs) / 1000)}s`}
            </button>
            {(status === "recovering" || status === "offline" || status === "error") && (
              <button
                type="button"
                onClick={reconnect}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <RotateCcw className="h-4 w-4" /> Kết nối lại
              </button>
            )}
          </div>
          {micTestResult && <p className="mt-2 text-[11px] text-zinc-400" aria-live="polite">{micTestResult}</p>}
        </div>

        {providerKind === "mock" && (
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="tracker-voice-mock-transcript">Mock transcript</label>
            <input
              id="tracker-voice-mock-transcript"
              value={mockText}
              onChange={(event) => setMockText(event.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            />
            <button
              type="button"
              onClick={emitMock}
              disabled={status !== "listening"}
              className="min-h-11 rounded-xl bg-emerald-300 px-4 text-xs font-bold text-emerald-950 disabled:opacity-35"
            >
              Phát final
            </button>
          </div>
        )}

        {bufferedEvents.length > 0 && (
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3" aria-live="polite">
            <div className="text-xs font-semibold text-amber-100">
              {bufferedEvents.length} transcript đang chờ Floor
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
              {bufferStatus ?? "Không action nào được ghi trong khi correction pending."}
            </p>
            <button
              type="button"
              onClick={() => void revalidateBufferedEvent()}
              className="mt-3 min-h-11 w-full rounded-xl border border-amber-200/30 bg-black/20 px-3 text-xs font-bold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Kiểm tra lại sau khi Floor sửa
            </button>
          </div>
        )}

        <div className={`rounded-xl border p-3 ${proposalTone(proposal)}`} aria-live="polite" aria-atomic="true">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">
            {proposal?.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Shadow proposal
          </div>
          <div className="text-sm font-semibold">{proposalLabel}</div>
          {finalTranscript && <div className="mt-1 text-[11px] opacity-65">“{finalTranscript}”</div>}
          {providerConfidence === null && finalTranscript && (
            <div className="mt-2 text-[10px] opacity-70">Provider không trả confidence tương thích: Auto bị khóa.</div>
          )}
          {validationState === "validating" && (
            <div className="mt-2 flex items-center gap-2 text-[11px] opacity-75">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang xác minh assignment và luật action trên server
            </div>
          )}
          {validationState === "validated" && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-200">
              <Check className="h-3.5 w-3.5" />
              {validatedReceipt?.execution_result === "alert_opened"
                ? "Alert đã vào hàng đợi Floor."
                : mode === "shadow"
                  ? "Shadow hợp lệ, không gọi server và chưa ghi action."
                  : "Đã xác minh, chờ Dealer xác nhận."}
            </div>
          )}
          {validationError && <div className="mt-2 text-[11px] text-rose-200">{validationError}</div>}
        </div>

        {mode === "assist"
          && validationState === "validated"
          && validatedProposal?.ok
          && "canonicalAction" in validatedProposal && (
            <button
              type="button"
              onClick={confirmAssist}
              className="min-h-11 w-full rounded-xl bg-emerald-300 px-4 text-sm font-bold text-emerald-950 outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
            >
              Xác nhận action
            </button>
          )}
        {validationState === "committing" && (
          <div className="flex min-h-11 items-center justify-center gap-2 text-xs text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang ghi qua canonical action writer
          </div>
        )}
        {validationState === "committed" && (
          <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-xs font-semibold text-emerald-200">
            <Check className="h-4 w-4" /> Action đã được Viewer/Replay nhận qua luồng hiện tại
          </div>
        )}
        {runtimeError && (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
            Chỉ xem: {runtimeError}
          </div>
        )}
      </div>
    </section>
  );
}
