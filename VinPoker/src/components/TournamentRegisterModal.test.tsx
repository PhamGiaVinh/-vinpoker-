import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registration = vi.hoisted(() => ({
  bank_name: null as string | null,
  account_number: null as string | null,
  account_holder: null as string | null,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "player-test" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({
    data: {
      registration_id: "registration-test", reference_code: "VINREGTEST", total_pay: 6_600_000,
      breakdown: { buy_in: 6_000_000, club_fee: 600_000 }, status: "pending",
      bank_name: registration.bank_name, account_number: registration.account_number,
      account_holder: registration.account_holder, qr_code_url: null,
    },
    error: null,
  })) } },
}));
vi.mock("@/components/tournament/seat/buyinReceipt", () => ({
  fetchBuyinReceipt: vi.fn(async () => null), toSeatReceiptData: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/kokonutui/liquid-glass-card", () => ({
  LiquidGlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LiquidButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import { TournamentRegisterModal } from "./TournamentRegisterModal";

describe("TournamentRegisterModal payment options", () => {
  beforeEach(() => {
    registration.bank_name = null;
    registration.account_number = null;
    registration.account_holder = null;
  });

  it("shows counter payment without inventing a bank transfer or QR", async () => {
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} />);
    expect(await screen.findByText("tournamentRegister.counterCashOnly")).toBeInTheDocument();
    expect(screen.getByText("VINREGTEST")).toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.transferInfo")).not.toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.proofTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.autoVerifyHint")).not.toBeInTheDocument();
  });

  it("keeps verified-bank instructions when the server supplies an account", async () => {
    registration.bank_name = "TEST BANK";
    registration.account_number = "999000001";
    registration.account_holder = "TEST CLUB";
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} />);
    expect(await screen.findByText("tournamentRegister.transferInfo")).toBeInTheDocument();
    expect(screen.getByText("999000001")).toBeInTheDocument();
    expect(screen.getByText("tournamentRegister.autoVerifyHint")).toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.counterCashOnly")).not.toBeInTheDocument();
  });
});
