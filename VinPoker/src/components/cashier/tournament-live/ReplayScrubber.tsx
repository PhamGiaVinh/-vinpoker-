// Replay transport for a completed hand: street tabs, a timeline slider, play /
// pause / step / speed controls, and a clickable action list. Self-contained —
// owns step/play/speed state, builds frames from the hand, and pushes the
// current frame to the parent via onFrame so the existing <LiveFelt> renders it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, ChevronsRight } from "lucide-react";
import { PokerCard } from "./PokerVisuals";
import {
  buildReplayFrames,
  streetFrameIndex,
  detectBigBlind,
  type ReplayFrame,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";
import { buildHandRankView } from "./viewer-hub/handRankView";
import { formatActionLabel, formatStack, type ActionLog } from "./LiveFelt";

const SPEEDS = [0.5, 1, 2, 4, 8];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

const HAND_CATEGORY_LABEL: Record<string, string> = {
  royal_flush: "Royal Flush",
  straight_flush: "Straight Flush",
  quads: "Four of a Kind",
  full_house: "Full House",
  flush: "Flush",
  straight: "Straight",
  trips: "Three of a Kind",
  two_pair: "Two Pair",
  pair: "One Pair",
  high_card: "High Card",
};

function initials(name: string): string {
  return (name.trim() || "?").slice(0, 2).toUpperCase();
}

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
  const finalFrame = frames[lastIndex];
  const isAtEnd = step >= lastIndex;
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
  // Winner rows: net = ending − starting (completed hands only). Sorted by net desc.
  const nets = useMemo(() => {
    if (!hud || !finalFrame?.payoutVerified) return [];
    return hand.players
      .filter((p) => p.ending_stack != null)
      .map((p) => ({ ...p, net: (p.ending_stack as number) - p.starting_stack }))
      .filter((p) => p.net !== 0)
      .sort((a, b) => b.net - a.net);
  }, [hud, hand, finalFrame?.payoutVerified]);

  // Ranking is a display-only evaluator view. It remains visible when the stored
  // payout is inconsistent, but winner/chop labels stay gated by payoutVerified.
  const rankedPlayers = useMemo(() => {
    if (!hud || !isAtEnd || !finalFrame) return [];
    const finalSeats = new Map(finalFrame.seats.map((seat) => [seat.player_id, seat]));
    return hand.players
      .filter((player) => {
        const seat = finalSeats.get(player.player_id);
        return player.hole_cards?.length === 2 && !seat?.is_folded;
      })
      .map((player) => ({
        player,
        rank: buildHandRankView(player.hole_cards ?? [], hand.community_cards ?? []),
        verifiedWinner: finalFrame.payoutVerified === true && finalFrame.showdownWinnerIds?.includes(player.player_id) === true,
      }))
      .filter((row) => row.rank !== null)
      .sort((a, b) => (b.rank?.score ?? 0) - (a.rank?.score ?? 0));
  }, [finalFrame, hand, hud, isAtEnd]);

  const summaryActions = sortedActions.slice(0, 6);
  // Hand-summary bullets — derived from ACTIONS + nets only (revealed data; no
  // hole-card source → no leak). All-in facts first, then winner lines.
  const bullets = (() => {
    if (!hud) return [];
    const out: string[] = [];
    const nameOf = (pid: string) => publicName(hand.players.find((p) => p.player_id === pid)?.display_name, pid);
    for (const a of sortedActions) {
      if (a.action_type === "all_in") {
        out.push(t("liveHub.replay.allInSummary", "{{name}} all-in {{amount}}{{bb}}", {
          name: nameOf(a.player_id),
          amount: formatStack(a.action_amount),
          bb: inBB(a.action_amount) ? ` (${inBB(a.action_amount)})` : "",
        }));
      }
    }
    for (const p of nets) {
      if (p.net > 0) out.push(t("liveHub.replay.winnerSummary", "{{name}} +{{amount}}{{bb}}", {
        name: publicName(p.display_name, p.player_id),
        amount: formatStack(p.net),
        bb: inBB(p.net) ? ` (+${inBB(p.net)})` : "",
      }));
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
          {isAtEnd && current?.showdownResult === "chop" ? (
            <div data-testid="replay-hud-chop" className="rounded-xl border border-[hsl(var(--viewer-neon)_/_0.35)] bg-[hsl(var(--viewer-neon)_/_0.08)] px-3 py-2 text-xs font-semibold text-[hsl(var(--viewer-neon))]">
              {t("liveHub.felt.chopPot", "Chop pot")} · {t("liveHub.replay.splitPot", "Pot được chia đều")}
            </div>
          ) : null}
          {isAtEnd && current?.showdownResult === "needs_resettle" && (
            <div data-testid="replay-hud-needs-resettle" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
              {t("liveHub.felt.needsResettle", "Cần tính lại kết quả")}
            </div>
          )}
          {isAtEnd && rankedPlayers.length > 0 && (
            <section data-testid="replay-hud-rankings" className="space-y-2 rounded-xl border border-[hsl(var(--poker-gold)_/_0.28)] bg-[hsl(var(--poker-gold)_/_0.05)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[hsl(var(--poker-gold))]">
                  {t("liveHub.replay.rankTitle", "Xếp hạng hand")}
                </span>
                {finalFrame?.payoutVerified ? (
                  <span className="text-[10px] font-semibold text-[hsl(var(--viewer-neon))]">
                    {t("liveHub.replay.resultVerified", "Đã xác nhận")}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-amber-300">
                    {t("liveHub.replay.rankUnverified", "Chưa xác nhận winner")}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {rankedPlayers.map((row, index) => {
                  if (!row.rank) return null;
                  const rankLabel = t(`liveHub.replay.rank.${row.rank.category}`, HAND_CATEGORY_LABEL[row.rank.category] ?? row.rank.category);
                  return (
                    <div key={row.player.player_id} className={`rounded-xl border px-2.5 py-2 ${row.verifiedWinner ? "border-[hsl(var(--viewer-neon)_/_0.55)] bg-[hsl(var(--viewer-neon)_/_0.1)]" : "border-border/35 bg-background/25"}`}>
                      <div className="flex items-start gap-2">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/80 text-[10px] font-black text-muted-foreground">{index + 1}</span>
                        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-border/70 bg-secondary text-[9px] font-bold text-muted-foreground">
                          {row.player.avatar_url ? <img src={row.player.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials(publicName(row.player.display_name, row.player.player_id))}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-foreground">{publicName(row.player.display_name, row.player.player_id)}</span>
                            {row.player.seat_number > 0 && <span className="text-[9px] text-muted-foreground">{t("liveHub.seat", "Ghế {{n}}", { n: row.player.seat_number })}</span>}
                            {row.verifiedWinner && <span className="rounded-md bg-[hsl(var(--viewer-neon)_/_0.16)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[hsl(var(--viewer-neon))]">{t("liveHub.replay.winner", "Thắng")}</span>}
                          </div>
                          <div className="mt-0.5 text-[11px] font-semibold text-[hsl(var(--poker-gold))]">
                            {rankLabel}
                            {row.rank.primaryRanks.length > 0 ? ` · ${row.rank.primaryRanks.join("-")}` : ""}
                            {row.rank.kickerRanks.length > 0 ? ` · ${t("liveHub.replay.kicker", "kicker")} ${row.rank.kickerRanks.join("-")}` : ""}
                          </div>
                          <div className="mt-1 flex items-center gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {row.rank.bestFive.map((card, cardIndex) => <PokerCard key={`${row.player.player_id}-${cardIndex}`} card={card} size="xs" className="h-8 w-6" />)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {isAtEnd && finalFrame?.payoutVerified && nets.length > 0 ? (
            <div className="space-y-1">
              {nets.map((p) => (
                <div key={p.player_id} className="flex min-h-11 items-center justify-between rounded-xl bg-background/35 px-3 py-2 text-xs">
                  <span className="truncate">
                    <span className="font-semibold text-foreground">{publicName(p.display_name, p.player_id)}</span>
                    {p.seat_number > 0 && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("liveHub.seat", "Ghế {{n}}", { n: p.seat_number })}</span>}
                  </span>
                  <span className={`tracker-num font-bold ${p.net > 0 ? "text-[hsl(var(--viewer-neon-bright))]" : "text-red-400"}`}>
                    {p.net > 0 ? "+" : ""}
                    {formatStack(p.net)}
                    {inBB(Math.abs(p.net)) ? (
                      <span className="ml-1 font-normal opacity-70">({p.net > 0 ? "+" : "-"}{inBB(Math.abs(p.net))})</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : isAtEnd && rankedPlayers.length === 0 && current?.showdownResult !== "chop" && current?.showdownResult !== "needs_resettle" ? (
            <div className="text-[11px] text-muted-foreground">{t("liveHub.replay.noResult", "Chưa có kết quả — xem tab Hành động.")}</div>
          ) : null}
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
          <div data-testid="replay-hud-action-summary" className="space-y-1.5 border-t border-border/20 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{t("liveHub.replay.actionSummary", "Diễn biến ván")}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{sortedActions.length} {t("liveHub.replay.actionCount", "hành động")}</span>
            </div>
            {summaryActions.length > 0 ? summaryActions.map((action, actionIndex) => {
              const rawName = hand.players.find((player) => player.player_id === action.player_id)?.display_name;
              const label = formatActionLabel({
                street: action.street,
                display_name: "",
                seat_number: 0,
                action_type: action.action_type,
                action_amount: action.action_amount,
                action_order: action.action_order,
              } as ActionLog);
              return (
                <button key={`summary-${action.action_order}`} type="button" onClick={() => { setHudTab("actions"); pauseAnd(() => setStep(actionIndex + 1)); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] transition-colors hover:bg-secondary/35">
                  <span className="w-12 shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground">{STREET_LABELS[action.street] ?? action.street}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{publicName(rawName, action.player_id)}</span>
                  <span className="shrink-0 font-semibold text-[hsl(var(--viewer-neon-bright))]">{label}</span>
                </button>
              );
            }) : <div className="rounded-lg bg-background/25 px-2 py-2 text-[11px] text-muted-foreground">{t("liveHub.replay.noActions", "Chưa có hành động được ghi.")}</div>}
            {sortedActions.length > summaryActions.length && (
              <button type="button" onClick={() => setHudTab("actions")} className="min-h-9 w-full rounded-lg border border-border/35 text-[10px] font-bold text-[hsl(var(--viewer-neon))] transition-colors hover:border-[hsl(var(--viewer-neon)_/_0.45)]">
                {t("liveHub.replay.showAllActions", "Xem tất cả {{count}} hành động", { count: sortedActions.length })}
              </button>
            )}
          </div>
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
