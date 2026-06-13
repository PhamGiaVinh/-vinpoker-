// Replay transport for a completed hand: street tabs, a timeline slider, play /
// pause / step / speed controls, and a clickable action list. Self-contained —
// owns step/play/speed state, builds frames from the hand, and pushes the
// current frame to the parent via onFrame so the existing <LiveFelt> renders it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from "lucide-react";
import {
  buildReplayFrames,
  streetFrameIndex,
  type ReplayFrame,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";
import { formatActionLabel, type ActionLog } from "./LiveFelt";

const SPEEDS = [0.5, 1, 2, 4, 8];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

interface ReplayScrubberProps {
  hand: ReplayHand;
  onFrame: (frame: ReplayFrame) => void;
}

export function ReplayScrubber({ hand, onFrame }: ReplayScrubberProps) {
  const frames = useMemo(() => buildReplayFrames(hand), [hand]);
  const streetIdx = useMemo(() => streetFrameIndex(frames), [frames]);
  const lastIndex = frames.length - 1;

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // New hand → rewind and pause.
  useEffect(() => {
    setStep(0);
    setIsPlaying(false);
  }, [hand]);

  // Push the current frame up to the parent felt.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  useEffect(() => {
    const f = frames[Math.min(step, lastIndex)];
    if (f) onFrameRef.current(f);
  }, [step, frames, lastIndex]);

  // Auto-advance while playing; stop at the end.
  useEffect(() => {
    if (!isPlaying) return;
    if (step >= lastIndex) {
      setIsPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= lastIndex) return s;
        return s + 1;
      });
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [isPlaying, speed, step, lastIndex]);

  const pauseAnd = (fn: () => void) => {
    setIsPlaying(false);
    fn();
  };

  const togglePlay = () => {
    if (step >= lastIndex) {
      setStep(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const sortedActions = useMemo(
    () => [...(hand.actions || [])].sort((a, b) => a.action_order - b.action_order),
    [hand]
  );

  const presentStreets = useMemo(
    () => Object.keys(STREET_LABELS).filter((s) => s in streetIdx),
    [streetIdx]
  );

  const currentStreet = frames[Math.min(step, lastIndex)]?.currentStreet;
  const current = frames[Math.min(step, lastIndex)];

  return (
    <div className="mt-3 bg-card border border-amber-500/25 rounded-xl p-3 space-y-3">
      {/* Street tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {presentStreets.map((s) => (
          <button
            key={s}
            onClick={() => pauseAnd(() => setStep(streetIdx[s]))}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              currentStreet === s
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "text-muted-foreground border-border hover:border-amber-500/40"
            }`}
          >
            {STREET_LABELS[s]}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground font-mono">
          {step}/{lastIndex}
        </span>
      </div>

      {/* Timeline slider */}
      <Slider
        value={[Math.min(step, lastIndex)]}
        min={0}
        max={Math.max(lastIndex, 1)}
        step={1}
        onValueChange={(v) => pauseAnd(() => setStep(v[0]))}
        aria-label="Tua lại hand"
      />

      {/* Transport + speed */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => pauseAnd(() => setStep(0))}
            title="Về đầu"
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => pauseAnd(() => setStep((s) => Math.max(0, s - 1)))}
            title="Lùi 1 bước"
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            title={isPlaying ? "Tạm dừng" : "Phát"}
            className="p-2 rounded-md bg-amber-500/90 hover:bg-amber-400 text-black font-bold transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => pauseAnd(() => setStep((s) => Math.min(lastIndex, s + 1)))}
            title="Tiến 1 bước"
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Tốc độ</span>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors ${
                speed === sp
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "text-muted-foreground border-border hover:border-emerald-500/40"
              }`}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>

      {/* Current action + action list */}
      {current?.latestAction && (
        <div className="text-xs text-amber-100 border-t border-border/20 pt-2">
          <span className="text-amber-300/70">Ghế {current.latestAction.seat_number} · </span>
          <span className="font-semibold text-emerald-300">{current.latestAction.display_name}</span>{" "}
          {formatActionLabel(current.latestAction)}
        </div>
      )}

      <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
        {sortedActions.map((a, i) => {
          const label = formatActionLabel({
            street: a.street,
            display_name: "",
            seat_number: 0,
            action_type: a.action_type,
            action_amount: a.action_amount,
            action_order: a.action_order,
          } as ActionLog);
          const name =
            hand.players.find((p) => p.player_id === a.player_id)?.display_name ||
            a.player_id.slice(0, 6);
          const active = step === i + 1;
          return (
            <button
              key={a.action_order}
              onClick={() => pauseAnd(() => setStep(i + 1))}
              className={`w-full flex justify-between items-center px-1.5 py-1 rounded text-xs border-b border-border/10 last:border-0 transition-colors ${
                active ? "bg-amber-500/15 text-amber-200" : "hover:bg-secondary/40"
              }`}
            >
              <span className="text-muted-foreground">
                <span className="text-[9px] uppercase tracking-wider text-amber-400/60 mr-1.5">
                  {STREET_LABELS[a.street]?.slice(0, 2) || a.street.slice(0, 2)}
                </span>
                <span className="text-emerald-400 font-semibold">{name}</span>
              </span>
              <span
                className={`font-semibold ${a.action_amount > 0 ? "text-amber-400" : "text-muted-foreground"}`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
