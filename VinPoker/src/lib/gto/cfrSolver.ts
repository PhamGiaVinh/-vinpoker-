import { RANKS, combosOf } from "./handMath";
import { GTOPosition, RAISE_SIZE } from "./openRanges50bb";
import { HandStrategy, CfrFacing } from "./cfrTypes";

type SolverPos = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";
const POS_MAP: Record<GTOPosition, SolverPos> = {
  UTG: "UTG", UTG1: "UTG", LJ: "MP", HJ: "MP",
  CO: "CO", BTN: "BTN", SB: "SB",
};

const NUM_HANDS = 169;
const NUM_ACTIONS = 4; // 0=Fold, 1=Call/Limp, 2=Raise/3bet, 3=Allin

interface HandInfo {
  index: number;
  hand: string;
  type: "pair" | "suited" | "offsuit";
  strength: number;
  combos: number;
}

function buildHandTable(): HandInfo[] {
  const out: HandInfo[] = [];
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      let hand: string;
      let type: HandInfo["type"];
      let strength: number;

      if (i === j) {
        type = "pair";
        hand = `${RANKS[i]}${RANKS[i]}`;
        if (i <= 2) strength = 0.90 + (13 - i) * 0.005;
        else if (i <= 5) strength = 0.75 + (13 - i) * 0.005;
        else strength = 0.60 + (13 - i) * 0.005;
      } else if (i < j) {
        type = "suited";
        hand = `${RANKS[i]}${RANKS[j]}s`;
        if (i < 5) strength = 0.70 + (13 - i) * 0.01 + (13 - j) * 0.005;
        else if (j - i <= 2) strength = 0.65 - i * 0.01;
        else if (j - i <= 4) strength = 0.60 - i * 0.01;
        else strength = 0.50 - i * 0.01 - j * 0.005;
      } else {
        type = "offsuit";
        hand = `${RANKS[j]}${RANKS[i]}o`;
        if (j < 5 && i < 5) strength = 0.65 + (13 - j) * 0.01 + (13 - i) * 0.005;
        else if (i - j <= 2) strength = 0.55 - j * 0.01;
        else strength = 0.40 - j * 0.01 - i * 0.005;
      }

      strength = Math.max(0, Math.min(1, strength));
      out.push({ index: idx, hand, type, strength, combos: combosOf(hand) });
      idx++;
    }
  }
  return out;
}

const HAND_TABLE = buildHandTable();

function equityFor(handIdx: number, pos: SolverPos): number {
  const s = HAND_TABLE[handIdx].strength;
  const vsRandom = 0.5 + (s - 0.5) * 0.6;
  switch (pos) {
    case "UTG": return vsRandom - 0.05;
    case "MP":  return vsRandom - 0.03;
    case "CO":  return vsRandom - 0.01;
    case "BTN": return vsRandom + 0.02;
    case "SB":  return vsRandom - 0.01;
    case "BB":  return vsRandom + 0.0;
  }
}

function openRaiseSize(pos: GTOPosition): number {
  const s = parseFloat(RAISE_SIZE[pos]);
  return Number.isFinite(s) ? s : 2.5;
}

interface SolveOpts {
  iterations?: number;
  stack?: number;
  pot?: number;
}

export class PreflopSolver {
  iterations: number;
  stack: number;
  pot: number;

  private regret: number[][] = [];
  private strategy: number[][] = [];
  private strategySum: number[][] = [];

  constructor(opts: SolveOpts = {}) {
    this.iterations = opts.iterations ?? 1000;
    this.stack = opts.stack ?? 50;
    this.pot = opts.pot ?? 1.5;
  }

  private reset() {
    this.regret = Array.from({ length: NUM_HANDS }, () => new Array(NUM_ACTIONS).fill(0));
    this.strategy = Array.from({ length: NUM_HANDS }, () => new Array(NUM_ACTIONS).fill(1 / NUM_ACTIONS));
    this.strategySum = Array.from({ length: NUM_HANDS }, () => new Array(NUM_ACTIONS).fill(0));
  }

  private updateStrategy() {
    for (let h = 0; h < NUM_HANDS; h++) {
      let sum = 0;
      for (let a = 0; a < NUM_ACTIONS; a++) {
        const v = Math.max(0, this.regret[h][a]);
        this.strategy[h][a] = v;
        sum += v;
      }
      if (sum > 0) {
        for (let a = 0; a < NUM_ACTIONS; a++) this.strategy[h][a] /= sum;
      } else {
        for (let a = 0; a < NUM_ACTIONS; a++) this.strategy[h][a] = 1 / NUM_ACTIONS;
      }
    }
  }

  private accumulateStrategy() {
    for (let h = 0; h < NUM_HANDS; h++) {
      for (let a = 0; a < NUM_ACTIONS; a++) {
        this.strategySum[h][a] += this.strategy[h][a];
      }
    }
  }

  private utility(
    pos: GTOPosition,
    facing: CfrFacing,
    betSize: number,
    raiserPos?: GTOPosition,
  ): number[][] {
    const u: number[][] = Array.from({ length: NUM_HANDS }, () => new Array(NUM_ACTIONS).fill(0));
    const sHero = POS_MAP[pos];
    // Tightness offset: each tier (open → 3bet → 4bet) the aggressor's range narrows.
    const raiserTightness = raiserPos
      ? ({ UTG: -0.06, UTG1: -0.05, LJ: -0.03, HJ: -0.02, CO: 0.0, BTN: 0.02, SB: 0.01 } as Record<GTOPosition, number>)[raiserPos]
      : 0;
    // Extra tightness when facing 3-bet or 4-bet
    const tierOffset = facing === "3bet" ? -0.08 : facing === "4bet" ? -0.14 : facing === "5bet" ? -0.20 : 0;

    for (let h = 0; h < NUM_HANDS; h++) {
      const eqBase = equityFor(h, sHero);
      const eq = Math.max(0, Math.min(1, eqBase + raiserTightness + tierOffset));

      if (facing === "raise") {
        // 0 fold, 1 call, 2 reraise (3bet ~3x), 3 allin
        u[h][0] = 0;

        const potOdds = betSize / (this.pot + betSize);
        u[h][1] = (eq - potOdds) * (this.pot + betSize);

        // 3-bet
        const reraise = betSize * 3;
        const oppFold = Math.max(0, 0.4 - eq * 0.3);
        const opp4Bet = Math.max(0, 0.1 + eq * 0.1);
        const oppCall = Math.max(0, 1 - oppFold - opp4Bet);
        const evFold = this.pot + betSize;
        const evCall = (eq * 2 - 1) * (this.pot + betSize + reraise);
        const ev4Bet = (eq * 2 - 1) * this.stack;
        u[h][2] = oppFold * evFold + oppCall * evCall + opp4Bet * ev4Bet;

        // All-in jam
        const jamFold = Math.max(0.05, 0.55 - eq * 0.4);
        const jamCalled = 1 - jamFold;
        const evJamFold = this.pot + betSize;
        const evJamCalled = (eq * 2 - 1) * this.stack;
        u[h][3] = jamFold * evJamFold + jamCalled * evJamCalled;
      } else if (facing === "3bet") {
        // Hero was the original raiser, now facing a 3-bet of `betSize` from raiserPos.
        // Actions: 0 fold, 1 call, 2 4-bet (~2.3x), 3 allin
        u[h][0] = 0;

        const potOdds = betSize / (this.pot + betSize);
        u[h][1] = (eq - potOdds) * (this.pot + betSize);

        const fourBet = betSize * 2.3;
        const oppFold = Math.max(0, 0.45 - eq * 0.25);
        const oppJam = Math.max(0, 0.15 + eq * 0.1);
        const oppCall = Math.max(0, 1 - oppFold - oppJam);
        const evFold = this.pot + betSize;
        const evCall = (eq * 2 - 1) * (this.pot + betSize + fourBet);
        const evJam = (eq * 2 - 1) * this.stack;
        u[h][2] = oppFold * evFold + oppCall * evCall + oppJam * evJam;

        const jamFold = Math.max(0.05, 0.5 - eq * 0.35);
        const jamCalled = 1 - jamFold;
        u[h][3] = jamFold * (this.pot + betSize) + jamCalled * (eq * 2 - 1) * this.stack;
      } else if (facing === "4bet" || facing === "5bet") {
        // Hero 3-bet, opponent 4-bet to `betSize`. Actions: fold / call / 5-bet jam / allin.
        u[h][0] = 0;

        const potOdds = betSize / (this.pot + betSize);
        u[h][1] = (eq - potOdds) * (this.pot + betSize);

        // 5-bet jam ≈ allin in 50bb context — collapse 2 and 3 toward all-in EV
        const jamFold = Math.max(0.05, 0.4 - eq * 0.3);
        const jamCalled = 1 - jamFold;
        const jamEv = jamFold * (this.pot + betSize) + jamCalled * (eq * 2 - 1) * this.stack;
        u[h][2] = jamEv;
        u[h][3] = jamEv;
      } else {
        // Open: 0 fold, 1 limp(SB only), 2 raise, 3 allin
        u[h][0] = 0;

        if (pos === "SB") {
          const limp = 0.5;
          const bbFold = Math.max(0, 0.3 - eq * 0.2);
          const bbRaise = Math.max(0, 0.2 + eq * 0.1);
          const bbCheck = Math.max(0, 1 - bbFold - bbRaise);
          const bbRaiseSize = 4;
          u[h][1] =
            bbFold * this.pot +
            bbCheck * (eq * 2 - 1) * (this.pot + limp) +
            bbRaise * (eq - 0.6) * (this.pot + limp + bbRaiseSize);
        } else {
          u[h][1] = -1000;
        }

        const raise = openRaiseSize(pos);
        const allFold = Math.max(0, 0.7 - eq * 0.3);
        const got3Bet = Math.max(0, 0.15 + eq * 0.05);
        const called = Math.max(0, 1 - allFold - got3Bet);
        const avg3Bet = raise * 3;
        u[h][2] =
          allFold * this.pot +
          called * (eq * 2 - 1) * (this.pot + raise) +
          got3Bet * (eq * 2 - 1) * (this.pot + raise + avg3Bet);

        // Open-shove
        const openJamFold = Math.max(0.1, 0.85 - eq * 0.5);
        const openJamCalled = 1 - openJamFold;
        u[h][3] =
          openJamFold * this.pot +
          openJamCalled * (eq * 2 - 1) * this.stack;
      }
    }
    return u;
  }

  private updateRegret(u: number[][]) {
    for (let h = 0; h < NUM_HANDS; h++) {
      let expected = 0;
      for (let a = 0; a < NUM_ACTIONS; a++) expected += this.strategy[h][a] * u[h][a];
      for (let a = 0; a < NUM_ACTIONS; a++) this.regret[h][a] += u[h][a] - expected;
    }
  }

  solve(
    pos: GTOPosition,
    facing: CfrFacing,
    betSize: number,
    raiserPos?: GTOPosition,
  ): HandStrategy[] {
    this.reset();
    for (let i = 0; i < this.iterations; i++) {
      this.updateStrategy();
      const u = this.utility(pos, facing, betSize, raiserPos);
      this.updateRegret(u);
      this.accumulateStrategy();
    }

    const out: HandStrategy[] = [];
    for (let h = 0; h < NUM_HANDS; h++) {
      let sum = 0;
      for (let a = 0; a < NUM_ACTIONS; a++) sum += this.strategySum[h][a];
      const probs = sum > 0
        ? this.strategySum[h].map((v) => v / sum)
        : new Array(NUM_ACTIONS).fill(1 / NUM_ACTIONS);
      const info = HAND_TABLE[h];
      out.push({
        hand: info.hand,
        index: h,
        combos: info.combos,
        fold: probs[0],
        call: probs[1],
        raise: probs[2],
        allin: probs[3],
      });
    }
    return out;
  }
}

export const HAND_INDEX = new Map(HAND_TABLE.map((h) => [h.hand, h.index]));
