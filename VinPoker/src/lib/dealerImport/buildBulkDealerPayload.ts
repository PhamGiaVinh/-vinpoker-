// ═══════════════════════════════════════════════════════════════════════════════
// Bulk dealer import — build dealer INSERT rows from a list of names (pure)
// ═══════════════════════════════════════════════════════════════════════════════
// Owner-chosen rules: every imported dealer is tier "B" (fixed); one employment
// type AND one salary are chosen for the WHOLE batch (PT → hourly rate, FT →
// monthly). ONLY the name comes from the file — never phone/salary/notes from the
// file itself. Mirrors AddDealerDialog's insert payload + its FT monthly→base/hourly
// derivation, so a bulk-imported dealer matches a manually-added one for payroll.
// Salary is optional: leave it blank and all pay fields stay null (configure later).

export type EmploymentType = "full_time" | "part_time";

export interface BulkDealerRow {
  club_id: string;
  full_name: string;
  tier: "B";
  employment_type: EmploymentType;
  status: "active";
  joined_date: string; // YYYY-MM-DD
  monthly_salary_vnd: number | null;
  hourly_rate_vnd: number | null;
  base_rate_vnd: number | null;
  standard_hours_per_shift: number | null;
  ot_multiplier: number | null;
  phone: null;
  notes: null;
}

/** Trim + collapse internal whitespace (display + dedup base). */
export function normalizeName(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** Dedup key (P1-2): trim + collapse whitespace + lowercase. Keeps Vietnamese diacritics. */
export function dedupeKey(raw: string): string {
  return normalizeName(raw).toLowerCase();
}

/** De-duplicate a name list case-insensitively, keeping first occurrence + original casing. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const clean = normalizeName(n);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function todayVN(): string {
  // Club-local (VN, UTC+7) calendar date — matches AddDealerDialog's joined_date semantics.
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** FT standard shift hours — used to derive the FT hourly rate (mirrors AddDealerDialog). */
const STANDARD_HOURS_PER_SHIFT = 8;
/** Working days per month baseline for FT daily/hourly derivation (AddDealerDialog uses 26). */
const WORKING_DAYS_PER_MONTH = 26;

/**
 * Build the exact rows to `supabase.from("dealers").insert([...])`.
 * tier is hard 'B'; employment type + salary are the batch choice.
 *   • PT: `salaryVnd` is the HOURLY rate → hourly_rate_vnd; monthly_salary_vnd = 0.
 *   • FT: `salaryVnd` is the MONTHLY salary → monthly_salary_vnd; base_rate_vnd =
 *     round(monthly / 26) and hourly_rate_vnd = round(monthly / 26 / 8), exactly
 *     mirroring AddDealerDialog so payroll treats a bulk dealer like a manual one.
 * `salaryVnd` is optional: null/absent/≤0 → all pay fields stay null (PT keeps
 * monthly_salary_vnd = 0), i.e. the previous "no salary, set later" behaviour.
 */
export function buildBulkDealerRows(
  names: string[],
  opts: { clubId: string; employmentType: EmploymentType; today?: string; salaryVnd?: number | null },
): BulkDealerRow[] {
  const joined = opts.today ?? todayVN();
  const isPT = opts.employmentType === "part_time";
  const salary = opts.salaryVnd != null && opts.salaryVnd > 0 ? Math.round(opts.salaryVnd) : null;

  const monthly_salary_vnd = isPT ? 0 : salary; // FT: entered monthly, or null if blank
  const hourly_rate_vnd = isPT
    ? salary // PT: entered hourly rate, or null
    : salary
      ? Math.round(salary / WORKING_DAYS_PER_MONTH / STANDARD_HOURS_PER_SHIFT)
      : null;
  const base_rate_vnd = !isPT && salary ? Math.round(salary / WORKING_DAYS_PER_MONTH) : null;
  const standard_hours_per_shift = isPT ? null : STANDARD_HOURS_PER_SHIFT;
  const ot_multiplier = isPT ? null : 1.5;

  return dedupeNames(names).map((full_name) => ({
    club_id: opts.clubId,
    full_name,
    tier: "B",
    employment_type: opts.employmentType,
    status: "active",
    joined_date: joined,
    monthly_salary_vnd,
    hourly_rate_vnd,
    base_rate_vnd,
    standard_hours_per_shift,
    ot_multiplier,
    phone: null,
    notes: null,
  }));
}
