import { useState } from "react";

import { TrackerVoicePanel } from "@/components/tracker/voice/TrackerVoicePanel";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import {
  MockRealtimeTranscriptionProvider,
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
  active_hand: {
    hand_id: HAND_ID,
    hand_number: 12,
    status: "in_progress",
    state_version: STATE_VERSION,
  },
};

interface PreviewAction {
  idempotencyKey: string;
  action: string;
  amount: number | null;
}

export default function TrackerVoiceV0Preview() {
  const [provider] = useState(() => new MockRealtimeTranscriptionProvider());
  const [actions, setActions] = useState<PreviewAction[]>([]);
  const [validationCount, setValidationCount] = useState(0);
  const [floorAlertCount, setFloorAlertCount] = useState(0);

  const validateEvent = async (input: ValidateVoiceEventInput): Promise<ValidatedVoiceEventReceipt> => {
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
  };

  const handleVoiceAction = async (
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
  };

  const hook = {
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
  } as unknown as StandaloneHandInput;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,.14),transparent_30%),#070a0c] p-3 text-zinc-100 md:p-6">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <TrackerVoicePanel
          hook={hook}
          providerOverride={provider}
          runtimeOverride={READY_RUNTIME}
          validateEventOverride={validateEvent}
        />

        <aside className="space-y-4">
          <section className="rounded-2xl border border-emerald-300/20 bg-black/30 p-4" aria-label="Mock E2E controls">
            <h1 className="text-lg font-black">Voice V0 local E2E</h1>
            <p className="mt-1 text-xs text-zinc-500">Dev-only fixture. Không kết nối Supabase hoặc OpenAI.</p>
            <button
              type="button"
              onClick={() => {
                provider.emit("call", { final: true, id: "duplicate-provider-item" });
                provider.emit("call", { final: true, id: "duplicate-provider-item" });
              }}
              className="mt-4 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-zinc-200"
            >
              Phát duplicate provider callback
            </button>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-[10px] text-zinc-500">Validated</dt><dd data-testid="validation-count" className="mt-1 font-mono text-xl text-emerald-300">{validationCount}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-[10px] text-zinc-500">Committed</dt><dd data-testid="canonical-action-count" className="mt-1 font-mono text-xl text-emerald-300">{actions.length}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-[10px] text-zinc-500">Floor</dt><dd data-testid="floor-alert-count" className="mt-1 font-mono text-xl text-amber-300">{floorAlertCount}</dd></div>
            </dl>
          </section>

          <section className="rounded-2xl border border-sky-300/20 bg-black/30 p-4" aria-label="Viewer Replay receipt">
            <h2 className="text-sm font-bold text-sky-200">Viewer / Replay canonical receipt</h2>
            {actions.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">Chưa có canonical action.</p>
            ) : (
              <ol className="mt-3 space-y-2" data-testid="viewer-replay-actions">
                {actions.map((action, index) => (
                  <li key={action.idempotencyKey} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm">
                    #{index + 1} · Player A · {action.action}{action.amount === null ? "" : ` tới ${action.amount.toLocaleString("vi-VN")}`}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-2xl border border-amber-300/20 bg-black/30 p-4" aria-label="Player Analytics mock proof">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">OPS-only analytics proof</div>
            <div className="mt-3 flex items-end justify-between">
              <div><div className="text-xs text-zinc-500">VPIP sample</div><strong data-testid="analytics-vpip" className="font-mono text-3xl text-emerald-300">{actions.length > 0 ? "100.0%" : "—"}</strong></div>
              <span className="text-xs text-zinc-500">{actions.length}/{actions.length}</span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
