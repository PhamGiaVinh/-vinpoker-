// TournamentPhotosManager (MediaCenter "Ảnh giải đấu" tab) — club-scoped: it loads
// the user's manageable clubs via the media_club_ids RPC, then their tournaments.
// These pin the two gates: no clubs → assignment-needed empty state; clubs+tours →
// the tour picker renders. (Upload is server-RLS-gated and not exercised here.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

let mockClubIds: unknown[] = [];
let mockTours: unknown[] = [];

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: mockClubIds, error: null }),
    from: () => ({ select: () => ({ in: () => ({ order: () => Promise.resolve({ data: mockTours, error: null }) }) }) }),
  },
}));

// eslint-disable-next-line import/first
import { TournamentPhotosManager } from "@/components/admin/TournamentPhotosManager";

beforeEach(() => { mockClubIds = []; mockTours = []; cleanup(); });

describe("TournamentPhotosManager", () => {
  it("shows the assignment-needed empty state when the user has no media clubs", async () => {
    mockClubIds = [];
    render(<TournamentPhotosManager />);
    expect(await screen.findByText(/chưa được gán CLB nào/i)).toBeTruthy();
  });

  it("renders the tour picker when the user manages clubs with tournaments", async () => {
    mockClubIds = [{ media_club_ids: "c1" }];
    mockTours = [{ id: "t1", name: "RPT Main", status: "live", club_id: "c1" }];
    render(<TournamentPhotosManager />);
    await waitFor(() => expect(screen.getByText(/Chọn giải đấu để tải ảnh/)).toBeTruthy());
  });
});
