// ═══════════════════════════════════════════════════════════════════════════════
// Bulk dealer import — build dealer INSERT rows from a list of names (pure)
// ═══════════════════════════════════════════════════════════════════════════════
// Owner-chosen rules: every imported dealer is tier "B" (fixed) and one
// employment type chosen for the WHOLE batch. ONLY the name comes from the file —
// no phone/salary/notes. Mirrors the field shape of AddDealerDialog's insert
// payload, but leaves all pay fields null (owner sets real salary per dealer
// later) so a few-hundred-row import can never inject a fake salary into payroll.

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

/**
 * Build the exact rows to `supabase.from("dealers").insert([...])`.
 * tier is hard 'B'; employment type is the batch choice; pay fields stay null
 * (configured per-dealer later). PT keeps monthly_salary_vnd = 0 to mirror the
 * single-add dialog's `isPT ? 0` shape; FT keeps the untouched shift defaults.
 */
export function buildBulkDealerRows(
  names: string[],
  opts: { clubId: string; employmentType: EmploymentType; today?: string },
): BulkDealerRow[] {
  const joined = opts.today ?? todayVN();
  const isPT = opts.employmentType === "part_time";
  return dedupeNames(names).map((full_name) => ({
    club_id: opts.clubId,
    full_name,
    tier: "B",
    employment_type: opts.employmentType,
    status: "active",
    joined_date: joined,
    monthly_salary_vnd: isPT ? 0 : null,
    hourly_rate_vnd: null,
    base_rate_vnd: null,
    standard_hours_per_shift: isPT ? null : 8,
    ot_multiplier: isPT ? null : 1.5,
    phone: null,
    notes: null,
  }));
}
