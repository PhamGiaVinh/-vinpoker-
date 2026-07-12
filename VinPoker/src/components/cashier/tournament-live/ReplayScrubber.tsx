// Replay transport for a completed hand: street tabs, a timeline slider, play /
// pause / step / speed controls, and a clickable action list. Self-contained —
// owns step/play/speed state, builds frames from the hand, and pushes the
// current frame to the parent via onFrame so the existing <LiveFelt> renders it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

export type ReplayFrameSource = "playback" | "scrub" | "jump";

interface ReplayScrubberProps {
  hand: ReplayHand;
  onFrame: (frame: ReplayFrame, source: ReplayFrameSource) => void;
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
  onSpeedChange?: (speed: number) => void;
}

export function ReplayScrubber({ hand, onFrame, hud = false, trackBets = false, onSpeedChange }: ReplayScrubberProps) {
  const { t } = useTranslation();
  const frames = useMemo(() => buildReplayFrames(hand, { trackBets }), [hand, trackBets]);
  const streetIdx = useMemo(() => streetFrameIndex(frames), [frames]);
  const lastIndex = frames.length - 1;

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Phase 3: default 2× (500ms/action) — 1×'s one-second dry steps read as "lag", and the
  // felt's fold-fade/count-up/chip-fly cover the transition. All speeds stay selectable.
  const [speed, setSpeed] = useState(2);
  const frameSourceRef = useRef<ReplayFrameSource>("jump");

  useEffect(() => {
    onSpeedChange?.(speed);
  }, [onSpeedChange, speed]);

  // New hand → rewind and pause.
  useEffect(() => {
    frameSourceRef.current = "jump";
    setStep(0);
    setIsPlaying(false);
  }, [hand]);

  // Push the current frame up to the parent felt.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  useEffect(() => {
    const f = frames[Math.min(step, lastIndex)];
    if (f) onFrameRef.current(f, frameSourceRef.current);
  }, [step, frames, lastIndex]);

  // Auto-advance while playing; stop at the end.
  useEffect(() => {
    if (!isPlaying) return;
    if (step >= lastIndex) {
      setIsPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      frameSourceRef.current = "playback";
      setStep((s) => {
        if (s >= lastIndex) return s;
        return s + 1;
      });
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [isPlaying, speed, step, lastIndex]);

  const pauseAnd = (fn: () => void) => {
    frameSourceRef.current = "scrub";
    setIsPlaying(false);
    fn();
  };

  const togglePlay = () => {
    if (step >= lastIndex) {
      frameSourceRef.current = "jump";
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
  const publicName = (name: string | null | undefined, playerId: string): string => {
    const trimmed = name?.trim() || "";
    const rawPrefix = playerId.slice(0, 6).toLowerCase();
    return trimmed && trimmed.toLowerCase() !== rawPrefix && !/^[a-f0-9]{6}$/i.test(trimmed)
      ? trimmed
      : t("liveHub.replay.unknownPlayer", "Người chơi");
  };

  // ── B1 HUD derivations (hud-only; all from the HAND's own data, never the clock) ──
  const [hudTab, setHudTab] = useState<"summary" | "actions">("summary");
  const bb = useMemo(() => (hud ? detectBigBlind(hand) : 0), [hud, hand]);
  const ante = useMemo(
    () => (hud ? Math.max(0, ...sortedActions.filter((a) => a.action_type === "post_ante").map((a) => a.action_amount), 0) : 0),
    [hud, sortedActions]
  );
  const inBB = (n: number): string | null => (bb > 0 ? `${(n / bb).toFixed(1)} BB` : null);
  // Settlement rows exist only on the current settlement frame. Pot awards and
  // uncalled refunds remain separate so a refund never looks like a win.
  const settlementRows = useMemo(() => {
    if (!hud || !current?.payoutVerified) return [];
    return current.seats
      .map((seat) => ({
        ...seat,
        payoutAward: Math.max(0, seat.payout_award ?? 0),
        refundAward: Math.max(0, seat.refund_award ?? 0),
      }))
      .filter((seat) => seat.payoutAward > 0 || seat.refundAward > 0)
      .sort((a, b) => b.payoutAward - a.payoutAward || b.refundAward - a.refundAward);
  }, [hud, current]);
  // Hand-summary bullets reveal only actions reached by the current replay frame.
  const bullets = (() => {
    if (!hud) return [];
    const out: string[] = [];
    const nameOf = (pid: string) => publicName(hand.players.find((p) => p.player_id === pid)?.display_name, pid);
    for (const a of sortedActions.slice(0, current?.index ?? 0)) {
      if (a.action_type === "all_in") {
        out.push(t("liveHub.replay.allInSummary", "{{name}} all-in {{amount}}{{bb}}", {
          name: nameOf(a.player_id),
          amount: formatStack(a.action_amount),
          bb: inBB(a.action_amount) ? ` (${inBB(a.action_amount)})` : "",
        }));
      }
    }
    return out.slice(0, 6);
  })();

  return (
    <div
      data-testid={hud ? "replay-action-rail" : undefined}
      className={hud
        ? "min-w-0 space-y-3 rounded-2xl border border-[hsl(var(--viewer-neon)_/_0.3)] bg-card/75 p-3.5 shadow-[0_18px_48px_hsl(var(--background)_/_0.35)] sm:p-4"
        : "mt-3 bg-card border border-amber-500/25 rounded-xl p-3 space-y-3"}
    >
      {/* B1 HUD strip — the RPT-style BB/ANTE + POT bar (hand's own blind, not the clock) */}
      {hud && (
        <div data-testid="replay-hud-bar" className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/45 px-3 text-[11px]">
          <span className="tracker-num font-bold text-[hsl(var(--viewer-neon))]">
            BB{ante > 0 ? "/ANTE" : ""} {bb > 0 ? formatStack(bb) : "—"}
            {ante > 0 ? ` / ${formatStack(ante)}` : ""}
          </span>
          <span className="tracker-num font-bold text-success">
            POT {formatStack(current?.potSize ?? 0)}
            {current && inBB(current.potSize) ? <span className="ml-1 font-normal opacity-70">({inBB(current.potSize)})</span> : null}
          </span>
          {current?.showdownResult && (
            <span className={`rounded-md border px-1.5 py-1 text-[9px] font-black uppercase tracking-wider ${
              current.showdownResult === "chop"
                ? "border-[hsl(var(--viewer-neon)_/_0.5)] text-[hsl(var(--viewer-neon))]"
                : current.showdownResult === "needs_resettle"
                  ? "border-amber-500/50 text-amber-300"
                  : "border-[hsl(var(--poker-gold)_/_0.5)] text-[hsl(var(--poker-gold))]"
            }`}>
              {current.showdownResult === "chop"
                ? t("liveHub.felt.chopPot", "Chop pot")
                : current.showdownResult === "needs_resettle"
                  ? t("liveHub.felt.needsResettle", "Cần tính lại")
                  : t("liveHub.felt.showdown", "Showdown")}
            </span>
          )}
        </div>
      )}
      {/* Street tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {presentStreets.map((s) => (
          <button
            key={s}
            onClick={() => pauseAnd(() => setStep(streetIdx[s]))}
            className={`${hud ? "min-h-11 rounded-xl px-3 py-1.5" : "px-2.5 py-1 rounded-md"} text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              currentStreet === s
                ? hud
                  ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.45)]"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : hud
                  ? "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
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
        aria-label={hud ? t("liveHub.replay.scrub", "Tua lại ván") : "Tua lại hand"}
        className={hud ? "py-2" : undefined}
      />

      {/* Transport + speed */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={hud ? "flex items-center gap-1.5" : "flex items-center gap-1.5"}>
          <button
            onClick={() => pauseAnd(() => setStep(0))}
            title={hud ? t("liveHub.replay.rewind", "Về đầu") : "Về đầu"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => pauseAnd(() => setStep((s) => Math.max(0, s - 1)))}
            title={hud ? t("liveHub.replay.previous", "Lùi 1 bước") : "Lùi 1 bước"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            title={hud
              ? isPlaying ? t("liveHub.replay.pause", "Tạm dừng") : t("liveHub.replay.play", "Phát")
              : isPlaying ? "Tạm dừng" : "Phát"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[hsl(var(--viewer-neon))] text-[hsl(var(--viewer-neon-ink))] font-bold transition hover:bg-[hsl(var(--viewer-neon-bright))]" : "p-2 rounded-md bg-amber-500/90 hover:bg-amber-400 text-black font-bold transition-colors"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => pauseAnd(() => setStep((s) => Math.min(lastIndex, s + 1)))}
            title={hud ? t("liveHub.replay.next", "Tiến 1 bước") : "Tiến 1 bước"}
            className={hud ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]" : "p-1.5 rounded-md border border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          {hud && (
            <button
              onClick={() => pauseAnd(() => setStep(lastIndex))}
              title={t("liveHub.replay.toEnd", "Tới cuối (showdown)")}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.4)] hover:text-[hsl(var(--viewer-neon))]"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className={hud ? "flex max-w-full items-center gap-1 overflow-x-auto" : "flex items-center gap-1"}>
          <span className="text-[10px] text-muted-foreground mr-1">{hud ? t("liveHub.replay.speed", "Tốc độ") : "Tốc độ"}</span>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              className={`${hud ? "min-h-11 min-w-11 rounded-xl px-2 py-1" : "px-1.5 py-0.5 rounded"} text-[10px] font-mono font-bold border transition-colors ${
                speed === sp
                  ? hud
                    ? "bg-[hsl(var(--viewer-neon)_/_0.15)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.4)]"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : hud
                    ? "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
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
        <div className="grid grid-cols-2 gap-1.5 border-t border-border/20 pt-3">
          {(["summary", "actions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setHudTab(tab)}
              className={`min-h-11 rounded-xl border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                hudTab === tab
                  ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))] border-[hsl(var(--viewer-neon)_/_0.45)]"
                  : "text-muted-foreground border-border hover:border-[hsl(var(--viewer-neon)_/_0.4)]"
              }`}
            >
              {tab === "summary" ? t("liveHub.replay.summary", "Tóm tắt") : t("liveHub.replay.actions", "Hành động")}
            </button>
          ))}
        </div>
      )}

      {hud && hudTab === "summary" && (
        <div data-testid="replay-hud-summary" className="space-y-2">
          {current?.showdownResult === "chop" ? (
            <div data-testid="replay-hud-chop" className="rounded-xl border border-[hsl(var(--viewer-neon)_/_0.35)] bg-[hsl(var(--viewer-neon)_/_0.08)] px-3 py-2 text-xs font-semibold text-[hsl(var(--viewer-neon))]">
              {t("liveHub.felt.chopPot", "Chop pot")} · {t("liveHub.replay.splitPot", "Pot được chia đều")}
            </div>
          ) : current?.showdownResult === "needs_resettle" ? (
            <div data-testid="replay-hud-needs-resettle" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
              {t("liveHub.felt.needsResettle", "Cần tính lại kết quả")}
            </div>
          ) : settlementRows.length > 0 ? (
            <div className="space-y-1">
              {settlementRows.map((p) => (
                <div key={p.player_id} className="flex min-h-11 items-center justify-between rounded-xl bg-background/35 px-3 py-2 text-xs">
                  <span className="truncate">
                    <span className="font-semibold text-foreground">{publicName(p.display_name, p.player_id)}</span>
                    {p.seat_number > 0 && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("liveHub.seat", "Ghế {{n}}", { n: p.seat_number })}</span>}
                  </span>
                  <span className="tracker-num flex flex-col items-end font-bold">
                    {p.payoutAward > 0 && (
                      <span className="text-[hsl(var(--viewer-neon-bright))]">
                        {t("liveHub.replay.potAward", "Thắng pot")} +{formatStack(p.payoutAward)}
                        {inBB(p.payoutAward) ? <span className="ml-1 font-normal opacity-70">(+{inBB(p.payoutAward)})</span> : null}
                      </span>
                    )}
                    {p.refundAward > 0 && (
                      <span className="text-[10px] text-amber-200/90">
                        {t("liveHub.replay.refund", "Hoàn")} +{formatStack(p.refundAward)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("liveHub.replay.noResult", "Chưa có kết quả — xem tab Hành động.")}</div>
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
        <div className={hud ? "border-t border-border/20 pt-3 text-xs text-foreground" : "text-xs text-amber-100 border-t border-border/20 pt-2"}>
          {(!hud || current.latestAction.seat_number > 0) && <span className={hud ? "text-muted-foreground" : "text-amber-300/70"}>{hud ? t("liveHub.seat", "Ghế {{n}}", { n: current.latestAction.seat_number }) : `Ghế ${current.latestAction.seat_number}`} · </span>}
          <span className={hud ? "font-semibold text-[hsl(var(--viewer-neon))]" : "font-semibold text-emerald-300"}>{hud ? publicName(current.latestAction.display_name, current.latestAction.player_id) : current.latestAction.display_name}</span>{" "}
          {formatActionLabel(current.latestAction)}
        </div>
      )}

      {(!hud || hudTab === "actions") && (
      <div className={hud ? "max-h-[min(42vh,460px)] space-y-1 overflow-y-auto pr-1" : "max-h-40 overflow-y-auto space-y-0.5 pr-1"}>
        {sortedActions.map((a, i) => {
          const label = formatActionLabel({
            street: a.street,
            display_name: "",
            seat_number: 0,
            action_type: a.action_type,
            action_amount: a.action_amount,
            action_order: a.action_order,
          } as ActionLog);
          const rawName = hand.players.find((p) => p.player_id === a.player_id)?.display_name;
          const name = hud ? publicName(rawName, a.player_id) : rawName || a.player_id.slice(0, 6);
          const active = step === i + 1;
          return (
            <button
              key={a.action_order}
              onClick={() => pauseAnd(() => setStep(i + 1))}
              className={hud
                ? `min-h-11 w-full flex justify-between items-center rounded-xl border border-border/35 px-3 py-2 text-left text-xs transition-colors ${active ? "bg-[hsl(var(--viewer-neon)_/_0.14)] text-[hsl(var(--viewer-neon))]" : "hover:bg-secondary/40"}`
                : `w-full flex justify-between items-center px-1.5 py-1 rounded text-xs border-b border-border/10 last:border-0 transition-colors ${active ? "bg-amber-500/15 text-amber-200" : "hover:bg-secondary/40"}`}
            >
              <span className="text-muted-foreground">
                <span className={hud ? "text-[9px] uppercase tracking-wider text-[hsl(var(--viewer-neon)_/_0.7)] mr-1.5" : "text-[9px] uppercase tracking-wider text-amber-400/60 mr-1.5"}>
                  {STREET_LABELS[a.street]?.slice(0, 2) || a.street.slice(0, 2)}
                </span>
                <span className={hud ? "text-[hsl(var(--viewer-neon-bright))] font-semibold" : "text-emerald-400 font-semibold"}>{name}</span>
              </span>
              <span
                className={`font-semibold ${a.action_amount > 0 ? (hud ? "text-[hsl(var(--viewer-neon-bright))]" : "text-amber-400") : "text-muted-foreground"}`}
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
