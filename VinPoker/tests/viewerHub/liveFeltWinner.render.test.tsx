import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";
import type { BestFiveFocus } from "@/lib/tracker-poker/replayBestFiveFocus";

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
});
