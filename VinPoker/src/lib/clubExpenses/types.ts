export type ClubExpenseSource = "mock" | "live";
export type ExpenseCategory = "rent" | "utilities" | "salary_topup" | "marketing" | "supplies" | "maintenance" | "tax_fee" | "misc";
export type ExpensePaymentStatus = "paid" | "unpaid";
export type ExpensePaymentSource = "cash" | "bank";

export interface ExpenseClub {
  id: string;
  name: string;
}

export interface ClubExpenseRow {
  id: string;
  clubId: string;
  category: ExpenseCategory;
  amountVnd: number;
  description?: string | null;
  incurredAt: string;
  tournamentId?: string | null;
  seriesId?: string | null;
  paymentStatus: ExpensePaymentStatus;
  paymentSource?: ExpensePaymentSource | null;
  attachmentUrl?: string | null;
  adjustsId?: string | null;
  enteredBy?: string | null;
  createdAt?: string | null;
}

export interface ClubExpensesSummary {
  clubId: string;
  from: string;
  to: string;
  rows: ClubExpenseRow[];
  totalVnd: number;
  paidVnd: number;
  unpaidVnd: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Mặt bằng",
  utilities: "Điện nước",
  salary_topup: "Bổ sung lương",
  marketing: "Marketing",
  supplies: "Vật tư",
  maintenance: "Bảo trì",
  tax_fee: "Thuế/phí",
  misc: "Khác",
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

