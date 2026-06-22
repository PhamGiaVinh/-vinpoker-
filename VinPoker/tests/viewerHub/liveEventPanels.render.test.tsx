// The three new event-tab panels: Giải thưởng (PrizesPanel) + Cấu trúc
// (StructurePanel) are read-only Supabase-backed tables; Hình ảnh (PhotosPanel) is
// a static placeholder. Mock the supabase query chain so the useEffect resolves
// with controllable rows; assert rows + empty states.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

let mockRows: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: mockRows, error: null }),
        }),
      }),
    }),
  },
}));

// eslint-disable-next-line import/first
import { PrizesPanel } from "@/components/cashier/tournament-live/viewer-hub/PrizesPanel";
// eslint-disable-next-line import/first
import { StructurePanel } from "@/components/cashier/tournament-live/viewer-hub/StructurePanel";
// eslint-disable-next-line import/first
import { PhotosPanel } from "@/components/cashier/tournament-live/viewer-hub/PhotosPanel";

beforeEach(() => { mockRows = []; });
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
  it("is a placeholder empty state", () => {
    render(<PhotosPanel />);
    expect(screen.getByText(/Chưa có ảnh/)).toBeTruthy();
  });
});
