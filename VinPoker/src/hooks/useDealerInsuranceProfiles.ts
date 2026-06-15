import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { DealerInsuranceProfile, InsurancePolicyRate } from "@/types/insurance";

// P4b-2: read+write the Insurance Participation Layer (dealer_insurance_profiles) and
// read the law table (insurance_policy_rates). Club-scoped (owner → owned clubs,
// super_admin → all). The insurance tables may NOT be applied yet (Phase 1 owner-gated)
// — when their queries fail, `tablesReady` flips false and the screen shows a notice
// instead of breaking. NEVER touches calculate_dealer_payroll / payroll numbers.

export interface InsuranceDealerRow {
  dealerId: string;
  fullName: string;
  employmentType: string | null;
  clubId: string;
  monthlySalaryVnd: number | null;
  profile: DealerInsuranceProfile | null; // active (effective_to IS NULL, non-series) profile
}

export interface SaveProfileInput {
  dealer_id: string;
  club_id: string;
  insurance_mode: DealerInsuranceProfile["insurance_mode"];
  region_code: DealerInsuranceProfile["region_code"];
  insurance_salary_vnd: number | null;
  include_bhxh: boolean;
  include_bhyt: boolean;
  include_bhtn: boolean;
  series_id: string | null;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

export function useDealerInsuranceProfiles({ clubFilter }: { clubFilter: string }) {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tablesReady, setTablesReady] = useState(true);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [dealers, setDealers] = useState<InsuranceDealerRow[]>([]);
  const [rates, setRates] = useState<InsurancePolicyRate[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ---- scope clubs (owner → owned; super_admin → all) ----
      let clubList: { id: string; name: string }[] = [];
      let scopedIds: string[] | null = null;
      if (isAdmin) {
        const { data } = await supabase.from("clubs").select("id, name").order("name");
        clubList = (data ?? []).map((c) => ({ id: c.id, name: c.name }));
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) { setClubs([]); setDealers([]); setLoading(false); return; }
        const { data } = await supabase.from("clubs").select("id, name").eq("owner_id", uid);
        clubList = (data ?? []).map((c) => ({ id: c.id, name: c.name }));
        scopedIds = clubList.map((c) => c.id);
        if (scopedIds.length === 0) { setClubs([]); setDealers([]); setLoading(false); return; }
      }
      setClubs(clubList);
      const restrictIds: string[] | null = clubFilter !== "all" ? [clubFilter] : scopedIds;

      // ---- dealers (always available) ----
      let dq = supabase.from("dealers")
        .select("id, full_name, employment_type, status, club_id, monthly_salary_vnd")
        .eq("status", "active").order("full_name").limit(2000);
      if (restrictIds) dq = dq.in("club_id", restrictIds);
      const { data: dealerRows, error: de } = await dq;
      if (de) throw de;

      // ---- insurance layer (may be unapplied → graceful) ----
      const profByDealer = new Map<string, DealerInsuranceProfile>();
      let ready = true;
      try {
        let pq = (supabase as any).from("dealer_insurance_profiles").select("*").is("effective_to", null);
        if (restrictIds) pq = pq.in("club_id", restrictIds);
        const { data: profs, error: pe } = await pq;
        if (pe) throw pe;
        (profs ?? []).forEach((p: DealerInsuranceProfile) => {
          if (!p.series_id) profByDealer.set(p.dealer_id, p);
        });
        const { data: rateRows, error: re } = await (supabase as any)
          .from("insurance_policy_rates").select("*").order("region_code");
        if (re) throw re;
        setRates((rateRows ?? []) as InsurancePolicyRate[]);
      } catch {
        ready = false; // Phase 1 tables not applied yet
        setRates([]);
      }
      setTablesReady(ready);

      setDealers((dealerRows ?? []).map((d: any): InsuranceDealerRow => ({
        dealerId: d.id,
        fullName: d.full_name,
        employmentType: d.employment_type,
        clubId: d.club_id,
        monthlySalaryVnd: d.monthly_salary_vnd,
        profile: profByDealer.get(d.id) ?? null,
      })));
    } catch (err) {
      console.error("[Insurance] load failed", err);
      setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu bảo hiểm");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clubFilter]);

  useEffect(() => { load(); }, [load]);

  // Upsert the dealer's OPEN non-series profile (update if one exists, else insert).
  const saveProfile = useCallback(async (input: SaveProfileInput) => {
    const { data: auth } = await supabase.auth.getUser();
    const existing = dealers.find((d) => d.dealerId === input.dealer_id)?.profile;
    const payload: Record<string, unknown> = { ...input, created_by: auth.user?.id ?? null };
    if (existing && !input.series_id) {
      const { error } = await (supabase as any).from("dealer_insurance_profiles").update(payload).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await (supabase as any).from("dealer_insurance_profiles").insert(payload);
      if (error) throw error;
    }
    await load();
  }, [dealers, load]);

  return { loading, error, tablesReady, clubs, dealers, rates, reload: load, saveProfile };
}
