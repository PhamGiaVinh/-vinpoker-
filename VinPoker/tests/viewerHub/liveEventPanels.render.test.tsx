// The three new event-tab panels: Giải thưởng (PrizesPanel) + Cấu trúc
// (StructurePanel) are read-only Supabase-backed tables; Hình ảnh (PhotosPanel) is
// a static placeholder. Mock the supabase query chain so the useEffect resolves
// with controllable rows; assert rows + empty states.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

let mockRows: unknown[] = [];
let mockLb: unknown = null; // get_tournament_leaderboard RPC result (finishers/champion)
// A thenable that also chains .order() any number of times (Prizes/Structure use one
// .order(); PhotosPanel uses .order().order()).
const makeResult = (): unknown => ({
  order: () => makeResult(),
  then: (res: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: mockRows, error: null }).then(res),
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => makeResult() }) }) }),
    rpc: () => Promise.resolve({ data: mockLb, error: null }),
  },
}));

// eslint-disable-next-line import/first
import { PrizesPanel } from "@/components/cashier/tournament-live/viewer-hub/PrizesPanel";
// eslint-disable-next-line import/first
import { StructurePanel } from "@/components/cashier/tournament-live/viewer-hub/StructurePanel";
// eslint-disable-next-line import/first
import { PhotosPanel } from "@/components/cashier/tournament-live/viewer-hub/PhotosPanel";

beforeEach(() => { mockRows = []; mockLb = null; });
afterEach(() => cleanup());

describe("PrizesPanel (Giải thưởng)", () => {
  it("renders a payout row per prize + the total", async () => {
    mockRows = [
      { position: 1, amount: 26500000, percentage: 50 },
      { position: 2, amount: 13250000, percentage: 25 },
    ];
    render(<PrizesPanel tournamentId="t1" />);
    expect(await screen.findByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("26.5M")).toBeTruthy();
    expect(screen.getByText(/Tổng thưởng/)).toBeTruthy();
  });

  it("shows an empty state when no prizes are configured", async () => {
    mockRows = [];
    render(<PrizesPanel tournamentId="t1" />);
    expect(await screen.findByText(/Chưa có cơ cấu giải thưởng/)).toBeTruthy();
  });

  it("shows the Champion card + finisher name when the leaderboard RPC returns positions", async () => {
    mockRows = [
      { position: 1, amount: 5000000, percentage: 50 },
      { position: 2, amount: 2500000, percentage: 25 },
    ];
    mockLb = {
      prize_pool: 10000000,
      players: [
        { position: 1, player_name: "Nguyễn Huy Hoàng", prize: 5000000 },
        { position: 2, player_name: "Trần Hoài Anh", prize: 2500000 },
        { position: 0, player_name: "Still Alive", prize: 0 },
      ],
    };
    render(<PrizesPanel tournamentId="t1" />);
    expect(await screen.findByText(/Nhà vô địch/)).toBeTruthy(); // champion card label
    expect(screen.getAllByText("Nguyễn Huy Hoàng").length).toBeGreaterThan(0); // champion + row
    expect(screen.getByText("Trần Hoài Anh")).toBeTruthy(); // 2nd-place finisher name in the row
  });
});

describe("StructurePanel (Cấu trúc)", () => {
  it("renders blind levels and styles break rows apart", async () => {
    mockRows = [
      { level_number: 1, small_blind: 100, big_blind: 200, ante: 0, duration_minutes: 20, is_break: false },
      { level_number: 2, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 10, is_break: true },
      { level_number: 3, small_blind: 200, big_blind: 400, ante: 400, duration_minutes: 20, is_break: false },
    ];
    render(<StructurePanel tournamentId="t1" currentLevel={3} />);
    expect(await screen.findByText("100 / 200")).toBeTruthy();
    expect(screen.getByText("200 / 400")).toBeTruthy();
    expect(screen.getByText(/Nghỉ giải lao/)).toBeTruthy();
  });

  it("shows an empty state when there is no structure", async () => {
    mockRows = [];
    render(<StructurePanel tournamentId="t1" />);
    expect(await screen.findByText(/Chưa có cấu trúc mù/)).toBeTruthy();
  });
});

describe("PhotosPanel (Hình ảnh)", () => {
  it("shows the empty state when a tour has no photos", async () => {
    mockRows = [];
    render(<PhotosPanel tournamentId="t1" />);
    expect(await screen.findByText(/Chưa có ảnh/)).toBeTruthy();
  });

  it("renders a gallery image per uploaded photo", async () => {
    mockRows = [
      { id: "p1", photo_url: "https://x/1.jpg" },
      { id: "p2", photo_url: "https://x/2.jpg" },
    ];
    const { container } = render(<PhotosPanel tournamentId="t1" />);
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(2));
  });
});
