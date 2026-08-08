import type {
  OpsRuntimeState,
  OpsSideEffectClass,
} from "@/ops/registry/opsModuleRegistry";

export type AccountantWorkspaceSection = {
  id: "payroll" | "staff" | "expenses" | "payment-preparation" | "reconciliation";
  label: string;
  state: OpsRuntimeState;
  sideEffectClass: OpsSideEffectClass;
  requiredContracts: readonly string[];
  reasonCode: string;
};

/**
 * Metadata-only shell. OpsModuleGate does not mount Accountant data or write
 * hooks while the registry module is BLOCKED. Individual sections can only be
 * promoted by a later contract-verification + UAT PR.
 */
export const ACCOUNTANT_WORKSPACE_SECTIONS = [
  {
    id: "payroll",
    label: "Payroll",
    state: "BLOCKED",
    sideEffectClass: "MONEY",
    requiredContracts: [
      "20270110000001 live receipt",
      "accountant payroll authority review",
      "authenticated write UAT",
    ],
    reasonCode: "ACCOUNTANT_PAYROLL_WRITE_UAT_REQUIRED",
  },
  {
    id: "staff",
    label: "Nhân sự",
    state: "BLOCKED",
    sideEffectClass: "DESTRUCTIVE",
    requiredContracts: ["staff write authority review", "authenticated write UAT"],
    reasonCode: "ACCOUNTANT_STAFF_WRITE_UAT_REQUIRED",
  },
  {
    id: "expenses",
    label: "Chi phí",
    state: "BLOCKED",
    sideEffectClass: "MONEY",
    requiredContracts: ["expense write authority review", "authenticated write UAT"],
    reasonCode: "ACCOUNTANT_EXPENSE_WRITE_UAT_REQUIRED",
  },
  {
    id: "payment-preparation",
    label: "Chuẩn bị thanh toán",
    state: "BLOCKED",
    sideEffectClass: "MONEY",
    requiredContracts: ["dual-control payment contract", "authenticated money-path UAT"],
    reasonCode: "ACCOUNTANT_PAYMENT_PREPARATION_BLOCKED",
  },
  {
    id: "reconciliation",
    label: "Đối soát",
    state: "BLOCKED",
    sideEffectClass: "MONEY",
    requiredContracts: ["reconciliation live contract", "authenticated money-path UAT"],
    reasonCode: "ACCOUNTANT_RECONCILIATION_BLOCKED",
  },
] as const satisfies readonly AccountantWorkspaceSection[];
