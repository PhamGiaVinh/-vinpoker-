// TournamentPhotosManager (MediaCenter "Ảnh giải đấu" tab) — club-scoped: it loads
// the user's manageable clubs via the UNION of media_club_ids + floor_club_ids RPCs,
// then their tournaments. These pin the gates: no clubs → assignment-needed empty
// state; media-clubs OR floor-clubs + tours → the tour picker renders. (Upload is
// server-RLS-gated and not exercised here.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

let mockMediaIds: unknown[] = [];
let mockFloorIds: unknown[] = [];
let mockTours: unknown[] = [];

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // RPC-name-aware so media vs floor club sources are independently testable.
    rpc: (name: string) =>
      Promise.resolve({ data: name === "floor_club_ids" ? mockFloorIds : mockMediaIds, error: null }),
    from: () => ({ select: () => ({ in: () => ({ order: () => Promise.resolve({ data: mockTours, error: null }) }) }) }),
  },
}));

// eslint-disable-next-line import/first
import { TournamentPhotosManager } from "@/components/admin/TournamentPhotosManager";

beforeEach(() => { mockMediaIds = []; mockFloorIds = []; mockTours = []; cleanup(); });

describe("TournamentPhotosManager", () => {
  it("shows the assignment-needed empty state when the user has no media or floor clubs", async () => {
    mockMediaIds = [];
    mockFloorIds = [];
    render(<TournamentPhotosManager />);
    expect(await screen.findByText(/chưa được gán CLB nào/i)).toBeTruthy();
  });

  it("renders the tour picker when the user manages MEDIA clubs with tournaments", async () => {
    mockMediaIds = [{ media_club_ids: "c1" }];
    mockTours = [{ id: "t1", name: "RPT Main", status: "live", club_id: "c1" }];
    render(<TournamentPhotosManager />);
    await waitFor(() => expect(screen.getByText(/Chọn giải đấu để tải ảnh/)).toBeTruthy());
  });

  it("renders the tour picker for a FLOOR-only user (union picks up floor_club_ids)", async () => {
    mockMediaIds = []; // no media role
    mockFloorIds = [{ floor_club_ids: "c2" }];
    mockTours = [{ id: "t2", name: "Floor Series", status: "live", club_id: "c2" }];
    render(<TournamentPhotosManager />);
    await waitFor(() => expect(screen.getByText(/Chọn giải đấu để tải ảnh/)).toBeTruthy());
  });
});
