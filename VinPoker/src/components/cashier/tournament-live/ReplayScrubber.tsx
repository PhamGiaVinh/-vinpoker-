// Replay transport for a completed hand: street tabs, a timeline slider, play /
// pause / step / speed controls, and a clickable action list. Self-contained —
// owns step/play/speed state, builds frames from the hand, and pushes the
// current frame to the parent via onFrame so the existing <LiveFelt> renders it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, ChevronsRight } from "lucide-react";
import {
  buildReplayFrames,
  streetFrameIndex,
  detectBigBlind,
  type ReplayFrame,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";
import { formatActionLabel, formatStack, type ActionLog } from "./LiveFelt";

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
  /**
   * B1 (liveReplayHud, viewer-only) — ADDITIVE; absent → render byte-identical.
   * Adds the RPT-style HUD: a BB/ANTE + POT (±BB) strip, a jump-to-end button, and
   * TÓM TẮT | HÀNH ĐỘNG tabs (winner rows ±BB + hand-summary bullets). All amounts use
   * the HAND's OWN blind (detectBigBlind), never the current clock level.
   */
  hud?: boolean;
  /**
   * UAT wave 2 (liveFeltCompact, viewer-only) — ADDITIVE; absent → frames are
   * byte-identical to today's. Frame seats additionally carry `current_bet` (chips
   * this street) + `total_committed` (ALL-IN pill amount) for the felt chip layer.
   */
  trackBets?: boolean;
}

export function ReplayScrubber({ hand, onFrame, hud = false, trackBets = false }: ReplayScrubberProps) {
  const frames = useMemo(() => buildReplayFrames(hand, { trackBets }), [hand, trackBets]);
  const streetIdx = useMemo(() => streetFrameIndex(frames), [frames]);
  const lastIndex = frames.length - 1;

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Phase 3: default 2× (500ms/action) — 1×'s one-second dry steps read as "lag", and the
  // felt's fold-fade/count-up/chip-fly cover the transition. All speeds stay selectable.
  const [speed, setSpeed] = useState(2);

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

  // ── B1 HUD derivations (hud-only; all from the HAND's own data, never the clock) ──
  const [hudTab, setHudTab] = useState<"summary" | "actions">("summary");
  const bb = useMemo(() => (hud ? detectBigBlind(hand) : 0), [hud, hand]);
  const ante = useMemo(
    () => (hud ? Math.max(0, ...sortedActions.filter((a) => a.action_type === "post_ante").map((a) => a.action_amount), 0) : 0),
    [hud, sortedActions]
  );
  const inBB = (n: number): string | null => (bb > 0 ? `${(n / bb).toFixed(1)} BB` : null);
  // Winner rows: net = ending − starting (completed hands only). Sorted by net desc.
  const nets = useMemo(() => {
    if (!hud) return [];
    return hand.players
      .filter((p) => p.ending_stack != null)
      .map((p) => ({ ...p, net: (p.ending_stack as number) - p.starting_stack }))
      .filter((p) => p.net !== 0)
      .sort((a, b) => b.net - a.net);
  }, [hud, hand]);
  // Hand-summary bullets — derived from ACTIONS + nets only (revealed data; no
  // hole-card source → no leak). All-in facts first, then winner lines.
  const bullets = useMemo(() => {
    if (!hud) return [];
    const out: string[] = [];
    const nameOf = (pid: string) => hand.players.find((p) => p.player_id === pid)?.display_name || pid.slice(0, 6);
    for (const a of sortedActions) {
      if (a.action_type === "all_in") {
        out.push(`${nameOf(a.player_id)} all-in ${formatStack(a.action_amount)}${inBB(a.action_amount) ? ` (${inBB(a.action_amount)})` : ""}`);
      }
    }
    for (const p of nets) {
      if (p.net > 0) out.push(`${p.display_name} +${formatStack(p.net)}${inBB(p.net) ? ` (+${inBB(p.net)})` : ""}`);
    }
    return out.slice(0, 6);
  }, [hud, sortedActions, nets, hand, bb]);

  return (
    <div className="mt-3 bg-card border border-amber-500/25 rounded-xl p-3 space-y-3">
      {/* B1 HUD strip — the RPT-style BB/ANTE + POT bar (hand's own blind, not the clock) */}
      {hud && (
        <div data-testid="replay-hud-bar" className="flex items-center justify-between gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 text-[11px]">
          <span className="tracker-num font-bold text-amber-300">
            BB{ante > 0 ? "/ANTE" : ""} {bb > 0 ? formatStack(bb) : "—"}
            {ante > 0 ? ` / ${formatStack(ante)}` : ""}
          </span>
          <span className="tracker-num font-bold text-emerald-300">
            POT {formatStack(current?.potSize ?? 0)}
            {current && inBB(current.potSize) ? <span className="ml-1 font-normal opacity-70">({inBB(current.potSize)})</span> : null}
          </span>
        </div>
      )}
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
          {hud && (
            <button
              onClick={() => pauseAnd(() => setStep(lastIndex))}
              title="Tới cuối (showdown)"
              className="p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          )}
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

      {/* B1: TÓM TẮT | HÀNH ĐỘNG tabs (hud only; !hud renders the list exactly as today) */}
      {hud && (
        <div className="flex items-center gap-1 border-t border-border/20 pt-2">
          {(["summary", "actions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setHudTab(tab)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border transition-colors ${
                hudTab === tab
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "text-muted-foreground border-border hover:border-amber-500/40"
              }`}
            >
              {tab === "summary" ? "Tóm tắt" : "Hành động"}
            </button>
          ))}
        </div>
      )}

      {hud && hudTab === "summary" && (
        <div data-testid="replay-hud-summary" className="space-y-2">
          {nets.length > 0 ? (
            <div className="space-y-1">
              {nets.map((p) => (
                <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-black/30 px-2.5 py-1.5 text-xs">
                  <span className="truncate">
                    {p.net > 0 && <span className="mr-1">👑</span>}
                    <span className="font-semibold text-foreground">{p.display_name}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">Ghế {p.seat_number}</span>
                  </span>
                  <span className={`tracker-num font-bold ${p.net > 0 ? "text-emerald-300" : "text-red-400"}`}>
                    {p.net > 0 ? "+" : ""}
                    {formatStack(p.net)}
                    {inBB(Math.abs(p.net)) ? (
                      <span className="ml-1 font-normal opacity-70">({p.net > 0 ? "+" : "-"}{inBB(Math.abs(p.net))})</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">Chưa có kết quả — xem tab Hành động.</div>
          )}
          {bullets.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-amber-400/70">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Current action + action list */}
      {(!hud || hudTab === "actions") && current?.latestAction && (
        <div className="text-xs text-amber-100 border-t border-border/20 pt-2">
          <span className="text-amber-300/70">Ghế {current.latestAction.seat_number} · </span>
          <span className="font-semibold text-emerald-300">{current.latestAction.display_name}</span>{" "}
          {formatActionLabel(current.latestAction)}
        </div>
      )}

      {(!hud || hudTab === "actions") && (
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
      )}
    </div>
  );
}
