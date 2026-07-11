import type { SalaryClub, SalaryMonthView, SalaryRow } from "./types";

export function mockSalaryClubs(): SalaryClub[] {
  return [{ id: "club-saigon", name: "VinPoker Sài Gòn", role: "owner" }];
}

const MOCK_PREVIEW: SalaryRow[] = [
  {
    staffId: "s-ft",
    fullName: "Minh Anh",
    department: "floor",
    employmentType: "full_time",
    workedDays: 24,
    grossVnd: 16_615_384,
    manualBhxhVnd: 800_000,
    manualTaxVnd: 0,
    netVnd: 15_815_384,
    alreadyLocked: false,
  },
  {
    staffId: "s-pt",
    fullName: "Bảo Trân",
    department: "cashier",
    employmentType: "part_time",
    workedMinutes: 3600,
    grossVnd: 3_300_000,
    manualBhxhVnd: 0,
    manualTaxVnd: 0,
    netVnd: 3_300_000,
    alreadyLocked: false,
  },
];

export function mockSalaryMonth(clubId: string, year: number, month: number): SalaryMonthView {
  const totalGrossVnd = MOCK_PREVIEW.reduce((s, r) => s + r.grossVnd, 0);
  const totalNetVnd = MOCK_PREVIEW.reduce((s, r) => s + r.netVnd, 0);
  return {
    clubId,
    year,
    month,
    standardShifts: 26,
    status: "prepared",
    submittedAt: null,
    approvedAt: null,
    rejectedReason: null,
    hasRuns: false,
    lockedRows: [],
    previewRows: MOCK_PREVIEW,
    totalGrossVnd,
    totalNetVnd,
  };
}
