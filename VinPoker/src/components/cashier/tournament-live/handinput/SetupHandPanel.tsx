// Setup step (engine mode) — the FIRST guided panel of a hand. Extracted from the
// inline start-hand JSX so the engine wizard can own it; the manual branch keeps
// its own inline copy byte-identical. Operator sets the hand number, taps the
// dealer-button seat (mandatory confirm), then starts the hand. Behaviour matches
// the original inline block exactly — this is a presentation-only extraction.

import { Play, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SeatRail, type RailSeat } from "./SeatRail";

interface SetupHandPanelProps {
  handNumber: number | "";
  onHandNumberChange: (value: number | "") => void;
  seats: RailSeat[];
  positions: Map<number, string>;
  buttonSeat: number;
  buttonConfirmed: boolean;
  onTapSeat: (seat: RailSeat) => void;
  onStartHand: () => void;
  submitting: boolean;
  lastHandId: string | null;
  onVoid: () => void;
}

export function SetupHandPanel({
  handNumber,
  onHandNumberChange,
  seats,
  positions,
  buttonSeat,
  buttonConfirmed,
  onTapSeat,
  onStartHand,
  submitting,
  lastHandId,
  onVoid,
}: SetupHandPanelProps) {
  return (
    <UiCard className="p-6 text-center space-y-4 border-dashed">
      <div className="flex items-center gap-3 justify-center">
        <label className="text-xs font-medium text-muted-foreground">Hand Number</label>
        <Input
          className="w-24"
          type="number"
          value={handNumber}
          onChange={(e) => onHandNumberChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      </div>
      {seats.length > 0 && (
        <div className="text-left max-w-xl mx-auto">
          <SeatRail
            seats={seats}
            positions={positions}
            buttonSeat={buttonSeat}
            toActId={null}
            selectedActorId={null}
            setupMode
            onTapSeat={onTapSeat}
          />
          {!buttonConfirmed && (
            <div className="mt-2 text-[11px] text-amber-300">
              ⚠ Chạm vào ghế nút chia bài (BTN) để xác nhận trước khi bắt đầu hand.
            </div>
          )}
        </div>
      )}
      <Button
        onClick={onStartHand}
        disabled={submitting || !handNumber || !buttonConfirmed}
        className="bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20"
      >
        <Play className="w-4 h-4 mr-2" /> Bắt đầu Hand
      </Button>
      {lastHandId && (
        <div className="pt-2">
          <Button size="sm" variant="destructive" onClick={onVoid} disabled={submitting}>
            <Undo2 className="w-3.5 h-3.5 mr-1" /> Void Last Hand ({lastHandId.slice(0, 8)})
          </Button>
        </div>
      )}
    </UiCard>
  );
}
