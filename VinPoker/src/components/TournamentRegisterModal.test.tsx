import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyinReceiptSnapshot } from "@/components/tournament/seat/buyinReceipt";

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
  fetchBuyinReceipt: vi.fn(async () => null), toSeatReceiptData: vi.fn((receipt) => receipt),
}));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({
  SeatReceiptDialog: ({ receipt }: { receipt: BuyinReceiptSnapshot }) =>
    <div data-testid="confirmed-buyin-receipt">{receipt.receipt_code}</div>,
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
import { fetchBuyinReceipt } from "@/components/tournament/seat/buyinReceipt";
import { supabase } from "@/integrations/supabase/client";

describe("TournamentRegisterModal payment options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows the server-confirmed receipt without registering or notifying twice", async () => {
    const onCompleted = vi.fn();
    vi.mocked(fetchBuyinReceipt).mockResolvedValueOnce({
      registration_id: "registration-test", receipt_code: "RECEIPT-TEST", qr_value: "RECEIPT-TEST",
      reference_code: "VINREGTEST", status: "confirmed", payment_state: "confirmed",
      club: { name: "CLB TEST", address: null, logo_url: null },
      player_name: "Người chơi TEST", tournament_name: "Tour A", total_pay: 6_600_000,
      completed_at: "2026-09-17T03:05:00Z", completed_at_source: "confirmed_at",
      table_number: 1, seat_number: 2, starting_stack: null,
    });
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A"
      open onClose={vi.fn()} onCompleted={onCompleted} />);
    expect(await screen.findByTestId("confirmed-buyin-receipt")).toHaveTextContent("RECEIPT-TEST");
    expect(fetchBuyinReceipt).toHaveBeenCalledWith({ registrationId: "registration-test" });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
