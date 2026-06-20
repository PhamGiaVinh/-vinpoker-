// Racetrack variant of the standalone operator console (PR-B).
//
// SAME engine: it takes the SAME `useStandaloneHandInput` hook as
// StandaloneHandInputConsole and renders the SAME guided sub-panels for blind
// setup / board entry / showdown / review. It swaps only the two presentational
// pieces the owner redesigned:
//   • the table felt   → <TrackerRacetrack>  (PR-A)
//   • the action step   → <ActionDock>+<ForcedAmountPad>  (PR-A)
// Every write still flows through the hook's existing handlers (record_action,
// record_hand, …) — the racetrack dock only emits an ActionIntent. The bet/raise
// TOTAL is forwarded via the hook's additive `betToTotal` param ⇒ the record_action
// payload is byte-identical to the old console (proven by the payload-parity test).
//
// Gated behind FEATURES.trackerRacetrackUi; while OFF the page renders the existing
// StandaloneHandInputConsole, so production is unchanged.

import { ArrowLeft, Loader2 } from "lucide-react";
import { displayCard, type Card } from "@/components/shared/CardSlotPicker";
import { TrackerRacetrack } from "@/components/tracker/TrackerRacetrack";
import { ActionDock } from "@/components/tracker/ActionDock";
import type { ActionIntent, SeatVM } from "@/components/tracker/types";
import { InputTableMap } from "./InputTableMap";
import { SetupHandPanel } from "./SetupHandPanel";
import { BlindSetupPanel } from "./BlindSetupPanel";
import { BoardEntryPanel } from "./BoardEntryPanel";
import { ShowdownInputPanel } from "./ShowdownInputPanel";
import { ReviewHandPanel } from "./ReviewHandPanel";
import { HandControlsStrip } from "./HandControlsStrip";
import { ViewerSyncStatus } from "./ViewerSyncStatus";
import { WorkflowProgressRail } from "./WorkflowProgressRail";
import { HandGuideDrawer } from "./HandGuideDrawer";
import { OperatorActionLog } from "./OperatorActionLog";
import type { PlayerState, StandaloneHandInput } from "./useStandaloneHandInput";

// players → racetrack SeatVM (display-only view-model).
function toSeatVMs(players: PlayerState[], positionsBySeat: Map<number, string>): SeatVM[] {
  return players.map((p) => ({
    seatNumber: p.seat_number,
    name: p.display_name,
    stack: p.current_stack, // chips BEHIND (audit Q5)
    committed: p.current_bet, // committed THIS street (audit Q5)
    position: positionsBySeat.get(p.seat_number) || undefined,
    isFolded: p.is_folded,
    isAllIn: p.is_all_in,
  }));
}

export function RacetrackHandInputConsole({ hook }: { hook: StandaloneHandInput }) {
  // No table chosen → operator table picker (full screen).
  if (!hook.tableId) {
    return (
      <div className="mx-auto max-w-3xl">
        <InputTableMap tables={hook.availableTables} activeTableId={null} onSelect={hook.handlePickTable} />
      </div>
    );
  }

  const bigBlind = hook.bigBlind;
  const disabled = hook.submitting || hook.isReadOnly;
  const seatVMs = toSeatVMs(hook.players, hook.positionsBySeat);
  const boardCards = hook.communityCards.map((c) => (c ? displayCard(c) : ""));
  const actorSeatVM = hook.actorPlayer ? toSeatVMs([hook.actorPlayer], hook.positionsBySeat)[0] : null;

  // Racetrack ActionDock intent → the SAME engine handlers. raise/bet forward the
  // TOTAL via betToTotal (= betToAdded → same added → same record_action payload);
  // fold/check/call/all_in let the controller compute (all_in keeps its confirm).
  const onIntent = (intent: ActionIntent) => {
    if (intent.action === "raise" || intent.action === "bet") {
      hook.handleDockAction(intent.action, intent.amount);
    } else {
      hook.handleDockAction(intent.action);
    }
  };

  // The guided sub-panel for the current workflow state (engine-only) — REUSED
  // unchanged, except the action step is the racetrack ActionDock.
  const guidedRegion = (() => {
    if (!hook.handStarted && !hook.orphanHand) {
      return (
        <SetupHandPanel
          handNumber={hook.handNumber}
          onHandNumberChange={hook.setHandNumber}
          seats={hook.players}
          positions={hook.positionsBySeat}
          buttonSeat={hook.buttonSeat}
          buttonConfirmed={hook.buttonConfirmed}
          onTapSeat={hook.handleSeatTap}
          onStartHand={hook.handleStartHand}
          submitting={hook.submitting}
          lastHandId={hook.lastHandId}
          onVoid={hook.handleVoid}
        />
      );
    }
    if (hook.isSummary) {
      return (
        <ReviewHandPanel
          players={hook.players}
          board={hook.communityCards}
          endingStacks={hook.endingStacks}
          onEndingStackChange={hook.handleEndingStackChange}
          potSize={hook.potSize}
          conservationOk={hook.conservationOk}
          winnerDetermined={hook.winnerDetermined}
          canSubmit={hook.reviewValid}
          onSubmit={hook.handleSubmitHand}
          onBack={() => hook.setEndingStacks({})}
          submitting={hook.submitting}
        />
      );
    }
    if (hook.showBlindSetup) {
      return (
        <BlindSetupPanel
          buttonSeat={hook.buttonSeat}
          sbSeat={hook.blindSbSeat}
          bbSeat={hook.blindBbSeat}
          firstActorSeat={hook.firstActorSeat}
          isHeadsUp={hook.isHeadsUp}
          players={hook.players}
          levelNumber={hook.blindLevelSnapshot?.level_number ?? null}
          ante={hook.blindLevelSnapshot?.ante ?? 0}
          levelMissing={hook.blindLevelMissing}
          sbAmount={hook.sbAmount}
          bbAmount={hook.bbAmount}
          onSbAmountChange={hook.setSbAmount}
          onBbAmountChange={hook.setBbAmount}
          sbPosted={hook.sbPosted}
          bbPosted={hook.bbPosted}
          onPost={hook.handlePostBlind}
          onConfirm={hook.handleConfirmBlinds}
          disabled={disabled}
        />
      );
    }
    if (hook.showBoardEntry && hook.boardEntryStreetNow) {
      return (
        <BoardEntryPanel
          street={hook.boardEntryStreetNow}
          communityCards={hook.communityCards}
          usedCards={hook.usedCards}
          onCardChange={(i, c) =>
            hook.setCommunityCards((prev) => {
              const n = [...prev];
              n[i] = c;
              return n;
            })
          }
          onSubmit={hook.handleUpdateCommunityCards}
          submitting={disabled}
          allInRunout={hook.allInRunout}
        />
      );
    }
    if (hook.showShowdownInput) {
      return (
        <ShowdownInputPanel
          players={hook.players}
          board={hook.communityCards}
          holeCards={hook.playerHoleCards}
          usedCards={hook.usedCards}
          onHoleCardChange={hook.handleHoleCardChange}
          onReveal={hook.handleShowHoleCards}
          selectedWinners={hook.selectedWinners}
          onToggleWinner={hook.handleToggleWinner}
          onConfirmResult={hook.handleConfirmShowdownResult}
          submitting={disabled}
        />
      );
    }
    if (hook.showActionStep && actorSeatVM) {
      return (
        <ActionDock
          actingSeat={actorSeatVM}
          toCall={hook.actorViewData?.toCall ?? 0}
          bigBlind={bigBlind}
          onIntent={onIntent}
          onUndo={hook.handleUndo}
        />
      );
    }
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/40 bg-card/50 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý bước tiếp theo…
      </div>
    );
  })();

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={hook.backToTableMap}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Bàn
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{hook.tableName}</div>
            <div className="text-[11px] text-muted-foreground">
              {hook.handStarted ? `Hand #${Number(hook.handNumber) || "?"}` : "Chưa bắt đầu"} · {hook.streetLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HandGuideDrawer />
          <ViewerSyncStatus phase={hook.syncPhase} lastLabel={hook.syncLabel} />
        </div>
      </div>

      {/* ORPHAN RESUME */}
      {hook.orphanHand && !hook.handStarted && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
          <span className="text-xs text-amber-200">
            Bàn này còn Hand #{hook.orphanHand.hand_number} đang dở. Tiếp tục nhập hay huỷ?
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={hook.submitting}
              onClick={hook.handleContinueOrphan}
              className="rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-40"
            >
              Tiếp tục
            </button>
            <button
              type="button"
              disabled={hook.submitting}
              onClick={hook.handleVoidOrphan}
              className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-40"
            >
              Huỷ hand
            </button>
          </div>
        </div>
      )}

      {/* PROGRESS RAIL */}
      {hook.handStarted && !hook.isSummary && (
        <WorkflowProgressRail state={hook.workflowState} allInRunout={hook.allInRunout} />
      )}

      {/* FELT — racetrack (PR-A) */}
      {hook.players.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-card/50 py-10 text-center text-sm text-muted-foreground">
          Bàn này chưa có người chơi đang hoạt động.
        </div>
      ) : (
        <TrackerRacetrack
          seats={seatVMs}
          actingSeatNumber={hook.actorPlayer?.seat_number ?? null}
          dealerSeatNumber={hook.buttonSeat}
          boardCards={boardCards}
          pot={hook.potSize}
          bigBlind={bigBlind}
          onSeatTap={hook.isReadOnly ? undefined : hook.handleSeatNumberTap}
        />
      )}

      {/* GUIDED ACTION REGION */}
      <div className="space-y-2">
        {guidedRegion}
        {hook.handStarted && !hook.isSummary && (
          <HandControlsStrip
            onUndo={hook.handleUndo}
            canUndo={hook.canUndo}
            onReset={hook.resetHand}
            onVoid={hook.handleVoid}
            hasVoidTarget={!!(hook.lastHandId || hook.handStarted)}
            disabled={hook.submitting}
          />
        )}
        {hook.handStarted && !hook.isSummary && hook.blindLevelChanged && (
          <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-300">
            Level mới đã bắt đầu. Ván này vẫn dùng Level {hook.blindLevelSnapshot?.level_number}; ván tiếp theo dùng
            Level {hook.liveLevelNumber}.
          </div>
        )}
      </div>

      {/* Board strip when not in board-entry (parity with the old console) */}
      {hook.handStarted && !hook.showBoardEntry && hook.communityCards.some(Boolean) && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-emerald-700/30 bg-emerald-950/30 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Board</span>
          <span className="font-mono text-sm tracking-wide text-foreground">
            {hook.communityCards.filter((c): c is Card => c !== null).map((c) => displayCard(c)).join("   ")}
          </span>
        </div>
      )}

      {/* LOG */}
      <OperatorActionLog actions={hook.actions} communityCards={hook.communityCards} />
    </div>
  );
}
