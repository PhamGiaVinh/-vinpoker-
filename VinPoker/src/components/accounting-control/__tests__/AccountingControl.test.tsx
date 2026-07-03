import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

afterEach(cleanup);

// Mutable FEATURES — tests flip accountingControl per scenario (house pattern: PrizesTab.test.tsx).
vi.mock("@/lib/featureFlags", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/featureFlags")>();
  return { ...actual, FEATURES: { ...actual.FEATURES, accountingControl: false } };
});

// Mutable auth — the page only reads isAdmin / isClubAdmin / isClubOwner.
const AUTH = { isAdmin: false, isClubAdmin: false, isClubOwner: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => AUTH }));

import AccountingControl from "@/pages/AccountingControl";
import { FEATURES } from "@/lib/featureFlags";
import { OverviewTab } from "../tabs/OverviewTab";
import { DailyCloseTab } from "../tabs/DailyCloseTab";
import { EventPnlTab } from "../tabs/EventPnlTab";
import { SeriesPnlTab } from "../tabs/SeriesPnlTab";
import { CashBankTab } from "../tabs/CashBankTab";
import { PayoutLiabilityTab } from "../tabs/PayoutLiabilityTab";
import { FnbFinanceTab } from "../tabs/FnbFinanceTab";
import { PayrollCostTab } from "../tabs/PayrollCostTab";
import { StakingEscrowTab } from "../tabs/StakingEscrowTab";
import { VarianceAlertsTab } from "../tabs/VarianceAlertsTab";
import { MonthlyReportTab } from "../tabs/MonthlyReportTab";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/club/admin/accounting-control"]}>
      <Routes>
        <Route path="/club/admin/accounting-control" element={<AccountingControl />} />
        <Route path="/club/admin" element={<div>REDIRECT_CLUB_ADMIN</div>} />
        <Route path="/" element={<div>REDIRECT_HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  (FEATURES as { accountingControl: boolean }).accountingControl = false;
  AUTH.isAdmin = false;
  AUTH.isClubAdmin = false;
  AUTH.isClubOwner = false;
});

describe("AccountingControl — flag + role gates", () => {
  it("flag ON + club owner → renders heading and all 11 tabs", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.getByText("Tài chính & Đối soát")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(11);
  });

  it("flag OFF + club owner (not super_admin) → redirected to /club/admin", () => {
    AUTH.isClubOwner = true;
    renderPage();
    expect(screen.getByText("REDIRECT_CLUB_ADMIN")).toBeInTheDocument();
    expect(screen.queryByText("Tài chính & Đối soát")).not.toBeInTheDocument();
  });

  it("flag OFF + super_admin → still renders (internal UAT bypass)", () => {
    AUTH.isAdmin = true;
    AUTH.isClubAdmin = true;
    renderPage();
    expect(screen.getByText("Tài chính & Đối soát")).toBeInTheDocument();
  });

  it("no owner/club-admin role → redirected home regardless of flag", () => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    renderPage();
    expect(screen.getByText("REDIRECT_HOME")).toBeInTheDocument();
  });
});

describe("AccountingControl — doctrine strings on the default tab", () => {
  beforeEach(() => {
    (FEATURES as { accountingControl: boolean }).accountingControl = true;
    AUTH.isClubOwner = true;
  });

  it("shows the mandatory pass-through explainer verbatim", () => {
    renderPage();
    expect(
      screen.getByText(/Doanh thu giữ lại ≠ tổng buy-in\. Prize pool và escrow là tiền pass-through\/liability, không phải doanh thu\./),
    ).toBeInTheDocument();
  });

  it("labels contribution with the operating-cost caveat and shows the mock banner", () => {
    renderPage();
    expect(screen.getAllByText(/Biên đóng góp \(chưa trừ chi phí vận hành chung\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/DỮ LIỆU MẪU \(mock\)/)).toBeInTheDocument();
  });
});

describe("Per-tab doctrine (rendered directly — Radix unmounts inactive TabsContent in jsdom)", () => {
  const noop = () => {};

  it("SeriesPnlTab carries the Series-Intelligence bridge verbatim", () => {
    render(<MemoryRouter><SeriesPnlTab /></MemoryRouter>);
    expect(
      screen.getByText(/Series Intelligence dự báo trước\. Accounting Control chốt số thật sau event\/series\. Forecast không phải accounting truth\./),
    ).toBeInTheDocument();
  });

  it('FnbFinanceTab shows the not-wired state (never "F&B chưa bật", never an earned 0)', () => {
    const { container } = render(<MemoryRouter><FnbFinanceTab /></MemoryRouter>);
    expect(screen.getByText(/Chưa nối dữ liệu tài chính F&B vào Accounting Control/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/F&B chưa bật/i);
    expect(container.textContent).not.toMatch(/0\s*₫/);
  });

  it("EventPnlTab shows the DUAL break-even labels (P0: never a generic break-even)", () => {
    render(<MemoryRouter><EventPnlTab /></MemoryRouter>);
    expect(screen.getByText(/Hòa vốn GTD \(đủ phủ đảm bảo\)/)).toBeInTheDocument();
    expect(screen.getByText(/Hòa vốn đóng góp \(gồm chi phí trực tiếp/)).toBeInTheDocument();
  });

  it("word guard across all 11 tabs: no 'lợi nhuận'/'net profit'; 'lãi ròng' only inside the negation", () => {
    const tabs = [
      <OverviewTab key="o" onNavigate={noop} />,
      <DailyCloseTab key="d" />,
      <EventPnlTab key="e" />,
      <SeriesPnlTab key="s" />,
      <CashBankTab key="c" />,
      <PayoutLiabilityTab key="p" />,
      <FnbFinanceTab key="f" />,
      <PayrollCostTab key="pr" />,
      <StakingEscrowTab key="st" />,
      <VarianceAlertsTab key="v" onNavigate={noop} />,
      <MonthlyReportTab key="m" />,
    ];
    for (const el of tabs) {
      const { container, unmount } = render(<MemoryRouter>{el}</MemoryRouter>);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/lợi nhuận|net profit/i);
      const laiRong = text.match(/lãi ròng/gi)?.length ?? 0;
      const negated = text.match(/chưa phải lãi ròng/gi)?.length ?? 0;
      expect(laiRong).toBe(negated); // mọi lần xuất hiện đều phải nằm trong câu phủ định
      unmount();
    }
  });
});
