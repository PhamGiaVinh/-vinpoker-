// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — dealer_schedule_runs.params (pure, no I/O)
// ═══════════════════════════════════════════════════════════════════════════════
// Persisted params shape (Patch 2, auto-fill build):
//   {
//     demand_overrides:   { <templateId>: need },        // per-day need deltas (pre-existing)
//     final_designations: { <templateId>: [dealerId] }   // "chia final" pins (new)
//   }
// `has_final` is NOT persisted — it is derived from a non-empty designation list.
// Parsing is TOLERANT: legacy params (demand_overrides only), null, or garbage
// never throw. Unknown dealer ids are KEPT (never silently dropped) so the UI can
// surface "dealer không còn tồn tại" instead of a pin quietly vanishing —
// validation (not parsing) decides what blocks Apply/Save.

export interface ShiftRunParams {
  demandOverrides: Record<string, number>;
  finalDesignations: Record<string, string[]>;
}

export const EMPTY_RUN_PARAMS: ShiftRunParams = { demandOverrides: {}, finalDesignations: {} };

/** Tolerant parse of a raw dealer_schedule_runs.params value. Non-object → empties;
 *  non-finite demand values dropped; designation arrays keep only strings, deduped
 *  (order preserved) — unknown/stale dealer ids are intentionally retained. */
export function parseRunParams(raw: unknown): ShiftRunParams {
  const out: ShiftRunParams = { demandOverrides: {}, finalDesignations: {} };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;

  const demand = obj.demand_overrides;
  if (demand != null && typeof demand === "object" && !Array.isArray(demand)) {
    for (const [templateId, v] of Object.entries(demand as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n) && n >= 0) out.demandOverrides[templateId] = Math.round(n);
    }
  }

  const finals = obj.final_designations;
  if (finals != null && typeof finals === "object" && !Array.isArray(finals)) {
    for (const [templateId, v] of Object.entries(finals as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const ids: string[] = [];
      for (const id of v) {
        if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id);
      }
      if (ids.length > 0) out.finalDesignations[templateId] = ids;
    }
  }
  return out;
}

/** Build the paramsExtra object handed to buildSaveRunPayload. Omits empty maps /
 *  arrays; returns undefined when there is nothing to persist — byte-parity with
 *  the pre-Patch-2 save path (`p_params = {}` for days without overrides). */
export function buildRunParamsExtra(p: ShiftRunParams): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  if (Object.keys(p.demandOverrides).length > 0) extra.demand_overrides = p.demandOverrides;
  const finals: Record<string, string[]> = {};
  for (const [templateId, ids] of Object.entries(p.finalDesignations)) {
    const clean = [...new Set(ids)].sort();
    if (clean.length > 0) finals[templateId] = clean;
  }
  if (Object.keys(finals).length > 0) extra.final_designations = finals;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

export interface FinalDesignationIssue {
  templateId: string;
  /** over_cap: pins > effective need · dealer_off: designee requested leave /
   *  unavailable that day (warning-level) · unknown_dealer: id not in the club's
   *  current ACTIVE dealer list (deleted or inactive) — blocks Apply/Save. */
  kind: "over_cap" | "dealer_off" | "unknown_dealer";
  dealerIds: string[];
}

/** Validate final designations against effective need + day availability.
 *  `needByTemplate` = need with per-day override applied (override ?? needCount).
 *  `offDealerIds` = dealers with leaveRequested/unavailable for the date.
 *  `knownDealerIds` (optional) = the club's current ACTIVE dealer ids. */
export function validateFinalDesignations(
  designations: Record<string, string[]>,
  needByTemplate: Record<string, number>,
  offDealerIds: Set<string>,
  knownDealerIds?: Set<string>
): FinalDesignationIssue[] {
  const issues: FinalDesignationIssue[] = [];
  for (const [templateId, rawIds] of Object.entries(designations)) {
    const ids = [...new Set(rawIds)];
    if (ids.length === 0) continue;
    const need = needByTemplate[templateId] ?? 0;
    if (ids.length > need) issues.push({ templateId, kind: "over_cap", dealerIds: ids });
    const off = ids.filter((id) => offDealerIds.has(id));
    if (off.length > 0) issues.push({ templateId, kind: "dealer_off", dealerIds: off });
    if (knownDealerIds) {
      const unknown = ids.filter((id) => !knownDealerIds.has(id));
      if (unknown.length > 0) issues.push({ templateId, kind: "unknown_dealer", dealerIds: unknown });
    }
  }
  return issues;
}

/** Canonical string key for dirty-state comparison: sorted template keys, sorted +
 *  deduped dealer arrays, empty maps/arrays omitted. Invariant under key/array
 *  ordering so hydrate → edit → undo lands back on the baseline. */
export function stableParamsKey(p: ShiftRunParams): string {
  const demand: Record<string, number> = {};
  for (const k of Object.keys(p.demandOverrides).sort()) demand[k] = p.demandOverrides[k];
  const finals: Record<string, string[]> = {};
  for (const k of Object.keys(p.finalDesignations).sort()) {
    const ids = [...new Set(p.finalDesignations[k])].sort();
    if (ids.length > 0) finals[k] = ids;
  }
  return JSON.stringify({ d: demand, f: finals });
}
