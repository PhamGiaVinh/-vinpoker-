import { useState } from "react";
import { useDealerTabletLandscape } from "@/hooks/useDealerTabletLandscape";
import { DealerTabletLayout } from "@/components/tracker/DealerTabletCockpit";
import { TrackerRacetrack } from "@/components/tracker/TrackerRacetrack";
import { TrackerInputCardProvider } from "@/components/tracker/TrackerCardStyle";
import { TrackerVoicePanel } from "@/components/tracker/voice/TrackerVoicePanel";
import { MockRealtimeTranscriptionProvider, type TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";

const actor = { player_id: "test-4", seat_number: 4, display_name: "Test 4", entry_number: 1, current_stack: 2000000, current_bet: 0 };
const hook = {
  tournamentId: "preview-tournament", tournamentTableId: "preview-table", tableId: "preview-physical", handId: "preview-hand",
  currentStreet: "flop", workflowState: "flop_action", handStarted: true, showActionStep: true, actions: [],
  engineActor: actor, actorPlayer: actor, players: [actor], buttonSeat: 1, communityCards: ["2d", "7c", "As"], persistedBoardCount: 3,
  actorViewData: { toCall: 100000, minRaiseTo: 200000, legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true } },
  handleVoiceAction: async () => true,
} as unknown as StandaloneHandInput;
const runtime: TrackerVoiceRuntimeContext = {
  ok: true, can_mint_session: true, read_only: false, correction_pending: false,
  config: { enabled: true, configured_mode: "assist", provider_model: "mock", spoken_amount_unit: 1, amount_unit_confirmed: false, provider_confidence_threshold: null, server_auto_allowed: true, correction_state: "ready" },
  active_hand: { hand_id: "preview-hand", hand_number: 1, status: "in_progress", state_version: "a".repeat(64) },
};
export default function DealerTabletPreview() {
  const tabletLandscape = useDealerTabletLandscape();
  const [provider] = useState(() => new MockRealtimeTranscriptionProvider());
  return <TrackerInputCardProvider><main className="min-h-screen bg-[#090f0d] p-3 text-white">
    <DealerTabletLayout hook={hook} trackerAllowed header={<div className="flex justify-between items-center"><div className="flex gap-5 items-center"><strong className="font-serif text-2xl text-amber-200">VBacker</strong><strong>Bàn 5</strong><span className="text-xs text-zinc-400">Dealer · vbacker</span></div><span className="text-xs text-amber-200">PREVIEW · Dữ liệu mô phỏng</span></div>}
      orphan={null} board={null} progress={<div className="flex justify-center gap-8 py-3 text-xs text-zinc-400"><span>Preflop</span><strong className="text-emerald-200">Flop</strong><span>Turn</span><span>River</span></div>}
      felt={<TrackerRacetrack portrait={tabletLandscape ? false : undefined} seats={Array.from({ length: 9 }, (_, i) => ({ seatNumber: i + 1, name: `Test ${i + 1}`, stack: 2000000, isEmpty: i === 4, position: i === 0 ? "BTN" : i === 1 ? "SB" : i === 2 ? "BB" : undefined }))} actingSeatNumber={4} dealerSeatNumber={1} boardCards={["2♦", "7♣", "A♠"]} pot={1250000} bigBlind={100000} rich betChips dealerFix feltV2 />}
      voice={<TrackerVoicePanel hook={hook} compact providerOverride={provider} runtimeOverride={runtime} validateEventOverride={async (input) => ({ ok: true, voice_event_id: input.providerEventId, idempotency_key: input.idempotencyKey, trace_id: input.traceId, state_version: "a".repeat(64), execution_mode: "assist", execution_result: "validated", correction_pending: false, alert_id: null })} />}
      guided={<div className="grid grid-cols-3 gap-2 rounded-xl border border-white/15 p-3">{["Fold", "Check", "Call", "Bet", "Raise", "All-in"].map((name) => <button key={name} className="min-h-11 rounded-lg border border-emerald-200/20 bg-emerald-950/50 text-sm">{name}</button>)}</div>}
      log={<p className="p-4 text-sm">Ghế 3 · Check</p>} />
  </main></TrackerInputCardProvider>;
}
