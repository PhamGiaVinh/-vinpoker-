// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const targets = [{ id: "main-1", name: "Main 1C", buy_in: 6000000, rake_amount: 600000, service_fee_amount: 0 }];
const targetQuery = {
  select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(),
  order: vi.fn(async () => ({ data: targets, error: null })),
};
targetQuery.select.mockReturnValue(targetQuery);
targetQuery.eq.mockReturnValue(targetQuery);
targetQuery.in.mockReturnValue(targetQuery);
targetQuery.is.mockReturnValue(targetQuery);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => targetQuery) },
}));
vi.mock("@/lib/featureFlags", () => ({
  FEATURES: { satelliteAwardsV1: true, multiDayTournaments: false, blindTemplates: false, tournamentServiceFee: false },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({}) }));

import { NewTournamentDialog } from "./TournamentManagerShared";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Satellite tour setup", () => {
  it("shows exact target and ticket GTD only in the Satellite create mode", async () => {
    const props = { clubs: [{ id: "club-1", name: "Club" }], defaultClubId: "club-1", multiClub: false, onCreated: vi.fn() };
    render(<NewTournamentDialog {...props} lockMode="satellite" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Satellite" }));
    expect(await screen.findByRole("combobox", { name: "Target tournament" })).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Guaranteed tickets (minimum)" })).toBeVisible();
    expect(screen.queryByText("GTD cam kết (VND)")).not.toBeInTheDocument();
  });

  it("keeps monetary GTD in regular tour setup without Satellite fields", () => {
    render(<NewTournamentDialog clubs={[{ id: "club-1", name: "Club" }]} defaultClubId="club-1"
      multiClub={false} onCreated={vi.fn()} lockMode="single" />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo giải thường" }));
    expect(screen.getByText("GTD cam kết (VND)")).toBeVisible();
    expect(screen.queryByRole("spinbutton", { name: "Guaranteed tickets (minimum)" })).not.toBeInTheDocument();
  });
});
