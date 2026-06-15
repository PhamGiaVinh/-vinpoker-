-- ════════════════════════════════════════════════════════════════════════════
-- GUARDED SEED — insurance_policy_rates for 2026 (Vietnam, 4 regions)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  NOT part of the Phase 1 migration. Owner-applied SEPARATELY (after the P4b
--     Phase 1 tables exist live). Seeding rates does NOT change payroll by itself —
--     payroll only reads them once P4b-3 ships AND a dealer has insurance_mode<>'NONE'.
--
-- Source: regional minimum wage from 01/01/2026 (Nghị định lương tối thiểu vùng);
--   BHTN max base = 20 × regional minimum wage (Luật Việc làm). BHXH/BHYT ceiling kept
--   at the current 20× base-salary figure (46,800,000) pending a dedicated update.
--   Employee rates: BHXH 8% · BHYT 1.5% · BHTN 1%. CONFIRM all figures before applying.
--
-- Idempotent on (region_code, effective_from) via the unique index.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.insurance_policy_rates
  (effective_from, effective_to, region_code, regional_min_wage_vnd,
   bhtn_cap_vnd, bhxh_cap_vnd, bhyt_cap_vnd,
   employee_bhxh_rate, employee_bhyt_rate, employee_bhtn_rate,
   employer_bhxh_rate, employer_bhyt_rate, employer_bhtn_rate, source_note)
VALUES
  ('2026-01-01', NULL, 'I',   5310000, 106200000, 46800000, 46800000, 0.08, 0.015, 0.01, 0.175, 0.03, 0.01, 'NĐ lương tối thiểu vùng 2026; BHTN cap = 20× min wage'),
  ('2026-01-01', NULL, 'II',  4730000,  94600000, 46800000, 46800000, 0.08, 0.015, 0.01, 0.175, 0.03, 0.01, 'NĐ lương tối thiểu vùng 2026; BHTN cap = 20× min wage'),
  ('2026-01-01', NULL, 'III', 4140000,  82800000, 46800000, 46800000, 0.08, 0.015, 0.01, 0.175, 0.03, 0.01, 'NĐ lương tối thiểu vùng 2026; BHTN cap = 20× min wage'),
  ('2026-01-01', NULL, 'IV',  3700000,  74000000, 46800000, 46800000, 0.08, 0.015, 0.01, 0.175, 0.03, 0.01, 'NĐ lương tối thiểu vùng 2026; BHTN cap = 20× min wage')
ON CONFLICT (region_code, effective_from) DO NOTHING;

-- Verify:
--   select region_code, regional_min_wage_vnd, bhtn_cap_vnd from public.insurance_policy_rates order by region_code;
--   -- expect 4 rows; bhtn_cap_vnd = 20 × regional_min_wage_vnd for each.
