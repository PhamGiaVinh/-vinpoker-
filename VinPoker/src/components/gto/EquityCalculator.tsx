import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Calculator, Sparkles, Zap, RotateCcw, Share2, Shuffle, Dices } from "lucide-react";
import { CardSlotPicker, RANKS, SUITS, SUIT_SYMBOL, SUIT_COLOR } from "@/components/shared/CardSlotPicker";
export type { Card } from "@/components/shared/CardSlotPicker";
import type { Card as CardType } from "@/components/shared/CardSlotPicker";

type Card = CardType;

/* ---------------- Card / Deck utils ---------------- */

const ALL_CARDS: Card[] = (() => {
  const out: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) out.push(`${r}${s}`);
  return out;
})();

const RANK_VAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/* ---------------- Hand evaluator ---------------- */
function kCombinations(n: number, k: number): number[][] {
  const res: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) { res.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  };
  rec(0);
  return res;
}

function evaluate5(cards: Card[]): number {
  const ranks = cards.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]);
  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ r: +r, c }))
    .sort((a, b) => (b.c - a.c) || (b.r - a.r));
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = Array.from(new Set(ranks));
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { isStraight = true; straightHigh = uniq[0]; }
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true; straightHigh = 5;
    }
  }
  const tiebreak = (arr: number[]) => arr.reduce((acc, v) => acc * 15 + v, 0);
  if (isStraight && isFlush) return 8e10 + straightHigh;
  if (groups[0].c === 4) return 7e10 + groups[0].r * 15 + groups[1].r;
  if (groups[0].c === 3 && groups[1].c === 2) return 6e10 + groups[0].r * 15 + groups[1].r;
  if (isFlush) return 5e10 + tiebreak(ranks);
  if (isStraight) return 4e10 + straightHigh;
  if (groups[0].c === 3) return 3e10 + groups[0].r * 225 + tiebreak(groups.slice(1).map((g) => g.r));
  if (groups[0].c === 2 && groups[1].c === 2) {
    const high = Math.max(groups[0].r, groups[1].r);
    const low = Math.min(groups[0].r, groups[1].r);
    return 2e10 + high * 225 + low * 15 + groups[2].r;
  }
  if (groups[0].c === 2) return 1e10 + groups[0].r * 3375 + tiebreak(groups.slice(1).map((g) => g.r));
  return tiebreak(ranks);
}

function evaluate7(cards: Card[]): number {
  let best = 0;
  const combos = kCombinations(cards.length, 5);
  for (const c of combos) {
    const v = evaluate5(c.map((i) => cards[i]));
    if (v > best) best = v;
  }
  return best;
}

/* ---------------- Player ---------------- */
type Mode = "exact" | "range" | "random";
type Player = {
  id: string;
  name: string;
  mode: Mode;
  cards: (Card | null)[]; // length 2
  rangeText: string;
};

function expandHand(hand: string): Card[][] {
  const out: Card[][] = [];
  const a = hand[0], b = hand[1];
  if (hand.length === 2) {
    for (let i = 0; i < SUITS.length; i++)
      for (let j = i + 1; j < SUITS.length; j++)
        out.push([`${a}${SUITS[i]}`, `${a}${SUITS[j]}`]);
  } else if (hand.endsWith("s")) {
    for (const s of SUITS) out.push([`${a}${s}`, `${b}${s}`]);
  } else {
    for (const s1 of SUITS) for (const s2 of SUITS) if (s1 !== s2) out.push([`${a}${s1}`, `${b}${s2}`]);
  }
  return out;
}

function parseRangeToCombos(txt: string): Card[][] {
  const out: Card[][] = [];
  txt.split(/[,\s]+/).forEach((t) => {
    const v = t.trim().toUpperCase();
    if (!v) return;
    if (/^[2-9TJQKA]{2}([SO])?$/.test(v)) {
      const a = v[0], b = v[1];
      if (a === b) out.push(...expandHand(a + b));
      else {
        const ai = RANKS.indexOf(a as any), bi = RANKS.indexOf(b as any);
        const hi = ai < bi ? a : b;
        const lo = ai < bi ? b : a;
        const suf = (v[2] || "O");
        out.push(...expandHand(`${hi}${lo}${suf === "S" ? "s" : "o"}`));
      }
    }
  });
  return out;
}

function comboCount(txt: string): number {
  return parseRangeToCombos(txt).length;
}

/* ---------------- Main ---------------- */
export default function EquityCalculator() {
  const { t } = useTranslation();
  const [board, setBoard] = useState<(Card | null)[]>([null, null, null, null, null]);
  const [players, setPlayers] = useState<Player[]>([
    { id: "hero", name: t("equityCalc.hero"), mode: "random", cards: [null, null], rangeText: "" },
    { id: "p1", name: `${t("equityCalc.opponent")} 1`, mode: "random", cards: [null, null], rangeText: "" },
  ]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ win: number; tie: number }[] | null>(null);
  const [betPct, setBetPct] = useState(50);

  const usedCards = useMemo(() => {
    const s = new Set<Card>();
    board.forEach((c) => c && s.add(c));
    players.forEach((p) => p.mode === "exact" && p.cards.forEach((c) => c && s.add(c)));
    return s;
  }, [board, players]);

  const setBoardCard = (i: number, c: Card | null) => {
    const nb = board.slice(); nb[i] = c; setBoard(nb);
  };
  const clearBoard = () => setBoard([null, null, null, null, null]);
  const randomCards = (count: number, startIdx: number) => {
    const used = new Set(usedCards);
    board.forEach((c, i) => { if (i >= startIdx && i < startIdx + count && c) used.delete(c); });
    const avail = ALL_CARDS.filter((c) => !used.has(c));
    const nb = board.slice();
    for (let i = 0; i < count; i++) {
      const j = (Math.random() * avail.length) | 0;
      nb[startIdx + i] = avail.splice(j, 1)[0];
    }
    setBoard(nb);
  };

  const updatePlayer = (id: string, patch: Partial<Player>) =>
    setPlayers(players.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPlayer = () => {
    if (players.length >= 9) return;
    setPlayers([...players, { id: `p${Date.now()}`, name: `${t("equityCalc.opponent")} ${players.length}`, mode: "random", cards: [null, null], rangeText: "" }]);
  };
  const removePlayer = (id: string) => setPlayers(players.filter((p) => p.id !== id && p.id !== "hero"));

  const resetAll = () => {
    setBoard([null, null, null, null, null]);
    setPlayers([
      { id: "hero", name: t("equityCalc.hero"), mode: "random", cards: [null, null], rangeText: "" },
      { id: "p1", name: `${t("equityCalc.opponent")} 1`, mode: "random", cards: [null, null], rangeText: "" },
    ]);
    setResults(null);
  };

  const simulate = async () => {
    setRunning(true);
    setResults(null);
    await new Promise((r) => setTimeout(r, 30));

    const TRIALS = 4000;
    const fixedBoard = board.filter(Boolean) as Card[];
    const wins = players.map(() => 0);
    const ties = players.map(() => 0);
    let valid = 0;

    // precompute combos per player
    const playerCombos: Card[][][] = players.map((p) => {
      if (p.mode === "exact") {
        if (p.cards[0] && p.cards[1]) return [[p.cards[0], p.cards[1]]];
        return []; // invalid
      }
      if (p.mode === "range" && p.rangeText.trim()) {
        const c = parseRangeToCombos(p.rangeText);
        return c.length ? c : [];
      }
      return []; // random — handled below
    });

    outer: for (let i = 0; i < TRIALS; i++) {
      const used = new Set<Card>(fixedBoard);
      const hands: Card[][] = [];
      for (let p = 0; p < players.length; p++) {
        const pl = players[p];
        let hand: Card[] | null = null;
        if (pl.mode === "exact") {
          if (!playerCombos[p].length) { setRunning(false); return; }
          hand = playerCombos[p][0];
          if (used.has(hand[0]) || used.has(hand[1])) continue outer;
        } else if (pl.mode === "range" && playerCombos[p].length) {
          // try a few times
          for (let t = 0; t < 20; t++) {
            const cand = playerCombos[p][(Math.random() * playerCombos[p].length) | 0];
            if (!used.has(cand[0]) && !used.has(cand[1])) { hand = cand; break; }
          }
          if (!hand) continue outer;
        } else {
          // random
          const avail = ALL_CARDS.filter((c) => !used.has(c));
          const a = avail.splice((Math.random() * avail.length) | 0, 1)[0];
          const b = avail.splice((Math.random() * avail.length) | 0, 1)[0];
          hand = [a, b];
        }
        used.add(hand[0]); used.add(hand[1]);
        hands.push(hand);
      }

      // draw remaining board
      const need = 5 - fixedBoard.length;
      const deck = ALL_CARDS.filter((c) => !used.has(c));
      const drawn: Card[] = [];
      for (let k = 0; k < need; k++) {
        const j = (Math.random() * deck.length) | 0;
        drawn.push(deck.splice(j, 1)[0]);
      }
      const fb = fixedBoard.concat(drawn);
      const scores = hands.map((h) => evaluate7([...h, ...fb]));
      const max = Math.max(...scores);
      const winners = scores.map((s) => s === max);
      const winCount = winners.filter(Boolean).length;
      winners.forEach((w, idx) => {
        if (w) {
          if (winCount === 1) wins[idx]++;
          else ties[idx]++;
        }
      });
      valid++;
      if (i % 400 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (!valid) { setRunning(false); return; }
    setResults(wins.map((w, i) => ({ win: (w / valid) * 100, tie: (ties[i] / valid) * 100 })));
    setRunning(false);
  };

  const minEquityCall = (betPct / 100) / (1 + 2 * (betPct / 100)) * 100;
  const breakevenBluff = (betPct / 100) / (1 + (betPct / 100)) * 100;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <Card className="p-4 sm:p-5 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold">{t("equityCalc.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("equityCalc.subtitle")}</p>
          </div>
        </div>
      </Card>

      {/* BOARD */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">{t("equityCalc.board")}</h3>
          <Button size="sm" variant="outline" onClick={clearBoard} className="h-7 text-[11px] rounded-full border-emerald-500/40 text-emerald-500 hover:text-emerald-400 uppercase tracking-wider">
            {t("equityCalc.clearBoard")}
          </Button>
        </div>

        <Card className="p-4 bg-muted/30">
          <div className="flex items-end justify-around gap-3 flex-wrap">
            {/* Flop */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-muted-foreground text-center">{t("equityCalc.flop")}</div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <CardSlotPicker key={i} value={board[i]} used={usedCards} onChange={(c) => setBoardCard(i, c)} />
                ))}
              </div>
            </div>
            {/* Turn */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-muted-foreground text-center">{t("equityCalc.turn")}</div>
              <CardSlotPicker value={board[3]} used={usedCards} onChange={(c) => setBoardCard(3, c)} />
            </div>
            {/* River */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-muted-foreground text-center">{t("equityCalc.river")}</div>
              <CardSlotPicker value={board[4]} used={usedCards} onChange={(c) => setBoardCard(4, c)} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            <Button size="sm" variant="secondary" onClick={() => randomCards(3, 0)} className="rounded-full h-8 text-xs">
              <Shuffle className="w-3 h-3" /> {t("equityCalc.randomFlop")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => randomCards(1, 3)} className="rounded-full h-8 text-xs">
              <Shuffle className="w-3 h-3" /> {t("equityCalc.randomTurn")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => randomCards(1, 4)} className="rounded-full h-8 text-xs">
              <Shuffle className="w-3 h-3" /> {t("equityCalc.randomRiver")}
            </Button>
          </div>
        </Card>
      </section>

      {/* PLAYERS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">{t("equityCalc.players")}</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-emerald-500 hover:text-emerald-400 text-xs">
              <Share2 className="w-3.5 h-3.5" /> {t("equityCalc.share")}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {players.map((p, idx) => {
            const r = results?.[idx];
            return (
              <Card key={p.id} className="p-4 bg-muted/30 border-border/60 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-base">{p.name}</h4>
                    {p.id !== "hero" && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-500" onClick={() => removePlayer(p.id)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  {/* Mode toggle */}
                  <div className="inline-flex rounded-full bg-background border border-border p-0.5 text-xs">
                    {(["exact", "range", "random"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => updatePlayer(p.id, { mode: m })}
                        className={cn(
                          "px-3 py-1 rounded-full capitalize transition",
                          p.mode === m ? "bg-emerald-500 text-white font-semibold" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {t(`equityCalc.mode${m[0].toUpperCase()}${m.slice(1)}` as any)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Body by mode */}
                <div className="flex items-center gap-3">
                  {p.mode === "exact" ? (
                    <div className="flex gap-1.5">
                      {[0, 1].map((i) => (
                        <CardSlotPicker
                          key={i}
                          value={p.cards[i]}
                          used={usedCards}
                          onChange={(c) => {
                            const nc = p.cards.slice(); nc[i] = c; updatePlayer(p.id, { cards: nc });
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      {[0, 1].map((i) => (
                        <div key={i} className="h-14 w-11 sm:h-16 sm:w-12 rounded-lg border-2 border-dashed border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground font-bold text-lg">
                          ?
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {p.mode === "random" && (
                      <p className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: t("equityCalc.randomHandHint") }} />
                    )}
                    {p.mode === "range" && (
                      <div className="space-y-1">
                        <Input
                          value={p.rangeText}
                          onChange={(e) => updatePlayer(p.id, { rangeText: e.target.value })}
                          placeholder={t("equityCalc.rangePlaceholder")}
                          className="h-9 text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {t("equityCalc.combos", { n: comboCount(p.rangeText) })}
                        </p>
                      </div>
                    )}
                    {p.mode === "exact" && (
                      <p className="text-xs text-muted-foreground">{t("equityCalc.exactHint")}</p>
                    )}
                  </div>
                </div>

                {/* Result row */}
                {r && (
                  <div className="border-t border-border/60 pt-3 flex items-end justify-between">
                    <div>
                      <div className="text-[10px] tracking-widest text-muted-foreground font-semibold">{t("equityCalc.win")}</div>
                      <div className="text-3xl font-bold text-emerald-500 tabular-nums">{r.win.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] tracking-widest text-muted-foreground font-semibold">{t("equityCalc.tie")}</div>
                      <div className="text-xl font-semibold text-muted-foreground tabular-nums">{r.tie.toFixed(1)}%</div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={addPlayer} disabled={players.length >= 9} className="rounded-full">
            <Plus className="w-4 h-4" /> {t("equityCalc.addOpponent")}
          </Button>
          <Button onClick={simulate} disabled={running} className="rounded-full flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-600 text-white">
            <Zap className="w-4 h-4" />
            {running ? t("equityCalc.calculating") : t("equityCalc.calculate")}
          </Button>
          <Button variant="ghost" onClick={resetAll} className="rounded-full">
            <RotateCcw className="w-4 h-4" /> {t("equityCalc.reset")}
          </Button>
        </div>
      </section>

      {/* CALL THEORY */}
      <section className="space-y-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> {t("equityCalc.callTheory")}
        </h3>
        <Card className="p-4 sm:p-5 space-y-4 border-primary/30 bg-primary/5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs sm:text-sm font-medium">{t("equityCalc.betSize")}</label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={betPct}
                  onChange={(e) => setBetPct(Math.max(1, Math.min(500, +e.target.value || 0)))}
                  className="h-8 w-20 text-right"
                />
              </div>
              <Slider value={[betPct]} min={1} max={300} step={1} onValueChange={(v) => setBetPct(v[0])} />

              <div className="rounded-lg bg-background/60 p-3 border border-border space-y-1">
                <div className="text-xs text-muted-foreground">{t("equityCalc.minEquity")}</div>
                <div className="text-2xl font-bold text-emerald-500">{minEquityCall.toFixed(1)}%</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {t("equityCalc.minEquityFormula", { bet: betPct })}
                </div>
              </div>

              <div className="rounded-lg bg-background/60 p-3 border border-border space-y-1">
                <div className="text-xs text-muted-foreground">{t("equityCalc.breakevenBluff")}</div>
                <div className="text-2xl font-bold text-rose-500">{breakevenBluff.toFixed(1)}%</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs sm:text-sm font-semibold">{t("equityCalc.commonRefs")}</div>
              <div className="space-y-1.5">
                {[
                  [33, 20], [50, 25], [66, 28.4], [75, 30], [100, 33.3], [150, 37.5], [200, 40],
                ].map(([bet, eq]) => (
                  <div
                    key={bet}
                    className={cn(
                      "grid grid-cols-[3rem_auto_1fr_3rem_auto] items-center gap-x-1.5 rounded-md px-3 py-1.5 text-xs sm:text-sm border tabular-nums",
                      Math.abs(bet - betPct) < 2
                        ? "bg-primary/15 border-primary/40 font-semibold"
                        : "bg-background/40 border-border"
                    )}
                  >
                    <span className="text-right">{bet}%</span>
                    <span className="text-muted-foreground">{t("equityCalc.potLabel")}</span>
                    <span className="text-muted-foreground text-center">→ {t("equityCalc.callPrefix")}</span>
                    <span className="text-right">{eq}%</span>
                    <span className="text-muted-foreground">{t("equityCalc.equityLabel")}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
