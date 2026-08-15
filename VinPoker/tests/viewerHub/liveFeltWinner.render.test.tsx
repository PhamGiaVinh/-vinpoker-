import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";
import {
  selectVerifiedPotLayerPresentation,
  type BestFiveFocus,
  type VerifiedShowdownPresentation,
} from "@/lib/tracker-poker/replayBestFiveFocus";

function seat(overrides: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: overrides.player_id ?? "player",
    display_name: overrides.display_name ?? "Player",
    seat_number: overrides.seat_number ?? 1,
    chip_count: overrides.chip_count ?? 20_000,
    is_active: true,
    table_id: "table-1",
    position: "",
    ...overrides,
  };
}

const winner = seat({
  player_id: "tom",
  display_name: "Tom Dwan",
  seat_number: 1,
  hole_cards: ["Jd", "Jh"],
  pot_winner: true,
  payout_award: 20_000,
  net_won: 10_000,
  hand_rank: {
    category: "quads",
    best_five: ["Jd", "Jh", "Jc", "Js", "Ah"],
    kickers: ["A"],
  },
});
const refundOnly = seat({
  player_id: "phil",
  display_name: "Phil Ivey",
  seat_number: 2,
  chip_count: 0,
  hole_cards: ["Qd", "As"],
  pot_winner: false,
  payout_award: 0,
  refund_award: 5_000,
});

const focus: BestFiveFocus = {
  enabled: true,
  winnerPlayerIds: new Set(["tom"]),
  boardCardCodes: new Set(["Jc", "Js", "Ah"]),
  holeCardCodesByPlayerId: new Map([["tom", new Set(["Jd", "Jh"])]]),
};

const showdownPresentation: VerifiedShowdownPresentation = {
  enabled: true,
  handId: "hand-1",
  frameIndex: 7,
  isChop: false,
  potLayers: [{
    potId: "main-1",
    kind: "main",
    amount: 20_000,
    winnerPlayerIds: ["tom"],
    allocations: [{ playerId: "tom", amount: 20_000 }],
  }],
  winners: [{
    playerId: "tom",
    playerName: "Tom Dwan",
    seatNumber: 1,
    category: "four_of_a_kind",
    bestFive: ["Jd", "Jh", "Jc", "Js", "Ah"],
    kickers: ["A"],
    rankingText: "Four Jacks - Ace kicker",
    holeBestFive: new Set(["Jd", "Jh"]),
  }],
  focus,
};

const baseProps = {
  seats: [winner, refundOnly],
  lastActorId: null,
  toActId: null,
  displayCards: ["Kh", "Jc", "Qh", "Ah", "Js"],
  potSize: 20_000,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: (amount: number) => `${(amount / 200).toFixed(0)} BB`,
};

function cardClass(html: string, code: string): string {
  const match = html.match(new RegExp(`<[^>]+data-card-code="${code}"[^>]+class="([^"]*)"`));
  return match?.[1] ?? "";
}

describe("LiveFelt verified best-five focus", () => {
  it("focuses the exact Hand #1 five cards and dims every other face-up card", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={focus} showdownResult="winner" />,
    );

    expect(html).toContain("tracker-best-five-focus-active");
    expect((html.match(/tracker-best-five-card/g) ?? []).length).toBe(5);
    for (const code of ["Jd", "Jh", "Jc", "Js", "Ah"]) {
      expect(cardClass(html, code)).toContain("tracker-best-five-card");
    }
    for (const code of ["Kh", "Qh", "Qd", "As"]) {
      expect(cardClass(html, code)).toContain("tracker-non-best-five-card");
    }
  });

  it("keeps only the winner avatar glow and removes payout, rank, refund, and duplicate best-five text", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={focus} showdownResult="winner" />,
    );

    expect((html.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-testid="seat-net-won"');
    expect(html).not.toContain('data-testid="seat-pot-award"');
    expect(html).not.toContain('data-testid="seat-hand-rank"');
    expect(html).not.toContain('data-testid="seat-refund-award"');
    expect(html).not.toMatch(/Thắng pot|Hoàn \+5k|quads|Kicker|Bộ 5 lá mạnh nhất/i);
    expect(html).toContain("20k");
    expect(html).toContain("100 BB");
  });

  it("shows verified ranking in the center only during the winner phase", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        tableFx
        bestFiveFocus={focus}
        showdownPresentation={showdownPresentation}
        bestFiveFocusPhase="static"
        showdownResult="winner"
      />,
    );

    expect(html).toContain('data-testid="felt-showdown-ranking"');
    expect(html).toContain('data-testid="felt-showdown-ranking-tom"');
    expect(html).toContain(showdownPresentation.winners[0].rankingText);

    const dimmed = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        tableFx
        bestFiveFocus={focus}
        showdownPresentation={showdownPresentation}
        bestFiveFocusPhase="dim"
        showdownResult="winner"
      />,
    );
    expect(dimmed).not.toContain('data-testid="felt-showdown-ranking"');
  });

  it("does not apply card focus when the derived focus is disabled", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={{ ...focus, enabled: false }} />,
    );

    expect(html).not.toContain("tracker-best-five-focus-active");
    expect(html).not.toContain("tracker-best-five-card");
    expect(html).not.toContain("tracker-non-best-five-card");
  });

  it("keeps operator and TV rendering free of viewer-only focus treatment", () => {
    const html = renderToStaticMarkup(<LiveFelt {...baseProps} bestFiveFocus={focus} />);
    expect(html).not.toContain("tracker-best-five-focus-active");
    expect(html).not.toContain("tracker-best-five-card");
    expect(html).not.toContain("tracker-non-best-five-card");
    expect(html).not.toContain("tracker-win-glow");
  });

  it("never promotes a refund-only player to winner glow or result text", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[refundOnly]}
        tableFx
        bestFiveFocus={null}
      />,
    );
    expect(html).not.toContain("tracker-win-glow");
    expect(html).not.toContain("Hoàn");
    expect(html).not.toContain("+5k");
  });

  it("collects committed chips, then awards only the active verified pot recipient", () => {
    const sideWinner = seat({
      player_id: "side",
      display_name: "Side winner",
      seat_number: 3,
      hole_cards: ["Ks", "Qs"],
      is_all_in: true,
      display_committed_bet: 8_000,
    });
    const layeredPresentation: VerifiedShowdownPresentation = {
      ...showdownPresentation,
      winners: [
        ...showdownPresentation.winners,
        {
          playerId: "side",
          playerName: "Side winner",
          seatNumber: 3,
          category: "one_pair",
          bestFive: ["Ks", "Qs", "Jc", "Js", "Ah"],
          kickers: ["A", "Q", "J"],
          rankingText: "Pair of Jacks - Ace-Q king kickers",
          holeBestFive: new Set(["Ks", "Qs"]),
        },
      ],
      potLayers: [
        showdownPresentation.potLayers[0],
        {
          potId: "side-1",
          kind: "side",
          amount: 8_000,
          winnerPlayerIds: ["side"],
          allocations: [{ playerId: "side", amount: 8_000 }],
        },
      ],
    };
    const collecting = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={focus}
        showdownPresentation={layeredPresentation}
        replayRunoutPhase="pot_collect"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_collect", visibleBoardCount: 5, potAwardIndex: null }}
      />,
    );
    expect(collecting).toContain('data-testid="felt-settlement-payout-motion"');
    expect((collecting.match(/data-testid="felt-settlement-collect-stack"/g) ?? []).length).toBe(2);
    expect(collecting).not.toContain('data-testid="felt-settlement-award-tom"');

    const mainPresentation = selectVerifiedPotLayerPresentation(layeredPresentation, 0);
    const mainAward = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={mainPresentation.focus}
        showdownPresentation={mainPresentation}
        replayRunoutPhase="pot_award"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_award", visibleBoardCount: 5, potAwardIndex: 0 }}
      />,
    );
    expect((mainAward.match(/data-testid="felt-settlement-award-tom"/g) ?? []).length).toBe(3);
    expect(mainAward).not.toContain('data-testid="felt-settlement-award-side"');
    expect((mainAward.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(mainAward).toContain('data-testid="felt-settlement-award-announcement"');
    expect(mainAward).toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(mainAward).toContain("Main Pot");
    expect(mainAward).toContain("Tom Dwan");
    expect(mainAward).toContain("+20k (100 BB)");
    expect(mainAward).toContain(showdownPresentation.winners[0].rankingText);
    expect((mainAward.match(/tracker-best-five-card/g) ?? []).length).toBe(5);

    const settledMain = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={mainPresentation.focus}
        showdownPresentation={mainPresentation}
        replayRunoutPhase="static"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "static", visibleBoardCount: 5, potAwardIndex: 0 }}
      />,
    );
    expect(settledMain).toContain('data-testid="felt-settlement-award-label-tom"');
    expect(settledMain).toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(settledMain).toContain("+20k (100 BB)");
    expect(settledMain).not.toContain('data-testid="felt-settlement-award-tom"');

    const sidePresentation = selectVerifiedPotLayerPresentation(layeredPresentation, 1);
    const sideAward = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={sidePresentation.focus}
        showdownPresentation={sidePresentation}
        replayRunoutPhase="pot_award"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_award", visibleBoardCount: 5, potAwardIndex: 1 }}
      />,
    );
    expect((sideAward.match(/data-testid="felt-settlement-award-side"/g) ?? []).length).toBe(3);
    expect(sideAward).not.toContain('data-testid="felt-settlement-award-tom"');
    expect((sideAward.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(sideAward).toContain('data-testid="felt-settlement-award-recipient-side"');
    expect(sideAward).not.toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(sideAward).toContain("Side Pot");
    expect(sideAward).toContain("Side winner");
    expect(sideAward).toContain("+8k (40 BB)");
    expect(sideAward).toContain("Pair of Jacks - Ace-Q king kickers");
    expect(sideAward).not.toContain(showdownPresentation.winners[0].rankingText);
    expect((sideAward.match(/tracker-best-five-card/g) ?? []).length).toBe(5);
  });

  it("makes the viewer portrait board larger without resizing operator cards", () => {
    const viewer = renderToStaticMarkup(
      <LiveFelt {...baseProps} viewerLayout portrait />,
    );
    const operator = renderToStaticMarkup(
      <LiveFelt {...baseProps} portrait />,
    );

    expect(viewer).toContain("width:clamp(30px,11.5cqi,50px)");
    expect(viewer).toContain("height:clamp(42px,16.2cqi,70px)");
    expect(operator).not.toContain("11.5cqi");
    expect(operator).not.toContain("16.2cqi");
  });
});
