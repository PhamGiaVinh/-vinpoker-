import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const AUTH = vi.hoisted(() => ({ isAdmin: false, isClubAdmin: false, isClubOwner: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => AUTH }));
vi.mock("@/components/series-market/VerifiedMarketJejuContent", () => ({
  VerifiedMarketJejuContent: () => <div>VERIFIED_MARKET_CONTENT</div>,
}));
vi.mock("@/lib/featureFlags", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/featureFlags")>();
  return { ...actual, FEATURES: { ...actual.FEATURES, seriesMarketVerifiedJeju: false } };
});

import { FEATURES } from "@/lib/featureFlags";
import VerifiedMarketJeju from "./VerifiedMarketJeju";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/club/admin/market-intelligence"]}>
      <Routes>
        <Route path="/club/admin/market-intelligence" element={<VerifiedMarketJeju />} />
        <Route path="/club/admin" element={<div>CLUB_ADMIN_REDIRECT</div>} />
        <Route path="/" element={<div>HOME_REDIRECT</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  AUTH.isAdmin = false;
  AUTH.isClubAdmin = false;
  AUTH.isClubOwner = false;
  (FEATURES as { seriesMarketVerifiedJeju: boolean }).seriesMarketVerifiedJeju = false;
});
afterEach(cleanup);

describe("VerifiedMarketJeju role and flag gate", () => {
  it("rejects unauthorized viewers even when the flag is on", () => {
    (FEATURES as { seriesMarketVerifiedJeju: boolean }).seriesMarketVerifiedJeju = true;
    renderPage();
    expect(screen.getByText("HOME_REDIRECT")).toBeInTheDocument();
  });

  it("keeps club owners dark while the flag is off", () => {
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.getByText("CLUB_ADMIN_REDIRECT")).toBeInTheDocument();
  });

  it("allows super admin internal preview while the flag is off", async () => {
    AUTH.isAdmin = true;
    renderPage();
    expect(await screen.findByText("VERIFIED_MARKET_CONTENT")).toBeInTheDocument();
  });

  it("allows a club admin after the later flag-on gate", async () => {
    AUTH.isClubAdmin = true;
    (FEATURES as { seriesMarketVerifiedJeju: boolean }).seriesMarketVerifiedJeju = true;
    renderPage();
    expect(await screen.findByText("VERIFIED_MARKET_CONTENT")).toBeInTheDocument();
  });
});
