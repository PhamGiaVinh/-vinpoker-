import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableHistoryPanel } from "./TableHistoryPanel";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("../PokerVisuals", () => ({ PokerCard: ({ card }: { card: string }) => <span>{card}</span> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string, values?: { name?: string }) => values?.name ? fallback.replace("{{name}}", values.name) : fallback }) }));

afterEach(() => rpc.mockReset());

describe("table-specific public history cards", () => {
  it("formats Hand #9 from its frozen 100k/200k/25k blind snapshot", async () => {
    rpc.mockResolvedValue({ data: { access: "public", items: [
      { handId: "hand-9", tableSessionId: "session-9", handNumber: 9, createdAt: "2026-09-27T01:00:00Z", board: ["2c", "7d", "9h", "3s", "Kc"], pot: 4_800_000, smallBlind: 100_000, bigBlind: 200_000, ante: 25_000, result: { status: "verified", recipients: [
        { playerId: "winner", entryNumber: 1, seatNumber: 1, name: "Winner", avatarUrl: null, holeCards: [], potAward: 4_800_000, netDelta: 2_400_000, potKinds: ["main"] },
      ] } },
    ], nextCursor: null }, error: null });
    render(<TableHistoryPanel tournamentId="tour-9" tableId="table-9" currentSessionId="session-9" onSelectHand={vi.fn()} onAccessRevoked={vi.fn()} />);
    const card = (await screen.findByText("Hand #9")).closest("article")!;
    expect(within(card).getByText("Pot 4.8M (24 BB)")).toBeInTheDocument();
    expect(within(card).getByText("100k/200k · Ante 25k")).toBeInTheDocument();
    expect(within(card).getByText("+2.4M (12 BB)")).toHaveClass("text-emerald-400");
  });

  it("renders verified recipients once with signed net, and keeps unverified hands visible", async () => {
    rpc.mockResolvedValue({ data: { access: "public", items: [
      { handId: "split", tableSessionId: "old-session", handNumber: 26, createdAt: "2026-09-17T01:00:00Z", board: ["AS"], pot: 280_000, smallBlind: 10_000, bigBlind: 20_000, ante: 0, result: { status: "verified", recipients: [
        { playerId: "a", entryNumber: 1, seatNumber: 2, name: "A", avatarUrl: null, holeCards: [], potAward: 240_000, netDelta: 160_000, potKinds: ["main"] },
        { playerId: "b", entryNumber: 1, seatNumber: 3, name: "B", avatarUrl: null, holeCards: [], potAward: 40_000, netDelta: -60_000, potKinds: ["side"] },
      ] } },
      { handId: "pending", tableSessionId: "current-session", handNumber: 25, createdAt: "2026-09-17T00:00:00Z", pot: null, bigBlind: null, result: { status: "pending" } },
    ], nextCursor: null }, error: null });
    const select = vi.fn();
    render(<TableHistoryPanel tournamentId="tour-a" tableId="table-a" currentSessionId="current-session" onSelectHand={select} onAccessRevoked={vi.fn()} />);
    const split = await screen.findByText("Hand #26");
    const card = split.closest("article")!;
    expect(within(card).getByText("Pot 280k (14 BB)")).toBeInTheDocument();
    expect(within(card).getByText("10k/20k · Ante 0")).toBeInTheDocument();
    expect(within(card).getByText("+160k (8 BB)")).toHaveClass("text-emerald-400");
    expect(within(card).getByText("−60k (3 BB)")).toHaveClass("text-rose-400");
    expect(within(card).getByText("Nhận pot phụ")).toBeInTheDocument();
    const pending = screen.getByText("Hand #25").closest("article")!;
    expect(within(pending).getByText("Pot —")).toBeInTheDocument();
    expect(within(pending).getByText("Kết quả đang được kiểm tra")).toBeInTheDocument();
    within(card).getByRole("button", { name: "Xem lại hand" }).click();
    expect(select).toHaveBeenCalledWith({ handId: "split", tableId: "table-a", handNumber: 26 });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_public_tournament_table_history_v2", expect.objectContaining({ p_tournament_id: "tour-a", p_tournament_table_id: "table-a" })));
  });
});
