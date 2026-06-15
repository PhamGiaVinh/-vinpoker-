// Payroll P4b — Insurance Participation Layer (Phase 1 source-aligned types).
// Hand-written to match migration 20260910000000_payroll_p4b_insurance_layer_phase1.sql.
// No runtime behavior, no UI — consumed by P4b-2 (profile UI) and P4b-3 (formula).
// Regenerate into integrations/supabase/types.ts once the tables are applied live.

export type InsuranceMode = 'NONE' | 'STATUTORY' | 'SERIES_ONLY';
export type InsuranceRegionCode = 'I' | 'II' | 'III' | 'IV';

/** public.insurance_policy_rates — statutory law snapshot, versioned by effective date. */
export interface InsurancePolicyRate {
  id: string;
  effective_from: string;        // date
  effective_to: string | null;   // date, null = current
  region_code: InsuranceRegionCode;
  regional_min_wage_vnd: number;
  bhtn_cap_vnd: number;          // = 20 × regional_min_wage_vnd
  bhxh_cap_vnd: number;
  bhyt_cap_vnd: number;
  employee_bhxh_rate: number;    // e.g. 0.08
  employee_bhyt_rate: number;    // e.g. 0.015
  employee_bhtn_rate: number;    // e.g. 0.01
  employer_bhxh_rate: number;
  employer_bhyt_rate: number;
  employer_bhtn_rate: number;
  source_note: string | null;
  created_at: string;
  updated_at: string;
}

/** public.dealer_insurance_profiles — per-dealer participation config (default NONE). */
export interface DealerInsuranceProfile {
  id: string;
  dealer_id: string;
  club_id: string;
  series_id: string | null;      // required when insurance_mode === 'SERIES_ONLY'
  effective_from: string;        // date
  effective_to: string | null;   // date, null = open
  insurance_mode: InsuranceMode; // default 'NONE'
  insurance_salary_vnd: number | null;
  region_code: InsuranceRegionCode | null;
  include_bhxh: boolean;
  include_bhyt: boolean;
  include_bhtn: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
