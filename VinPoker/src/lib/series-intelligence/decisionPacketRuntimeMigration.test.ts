import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");
const migrations = join(appRoot, "supabase", "migrations");
const file = "20270108000002_series_private_actual_truth_runtime_v1.sql";
const sql = readFileSync(join(migrations, file), "utf8");
const normalized = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("D2B private actual truth source migration", () => {
  it("is a single additive migration after D2A", () => {
    const versions = readdirSync(migrations).filter((name) => /^\d{14}_.+\.sql$/.test(name));
    expect(versions.filter((name) => name.startsWith("20270108000002_"))).toEqual([file]);
    expect(normalized).toContain("create table if not exists public.series_event_actual_native_sources_v1");
    expect(normalized).toContain("create table if not exists public.series_event_actual_reconciliations_v1");
    expect(normalized).not.toMatch(/\b(drop|truncate)\s+table\b/);
  });

  it("uses native confirmed-registration and prize-contribution contracts rather than the mutable cache", () => {
    expect(normalized).toContain("native-tournament-confirmed-registration-v1");
    expect(normalized).toContain("native-confirmed-prize-contribution-v1");
    expect(normalized).toContain("tr.status = 'confirmed'");
    expect(normalized).toContain("sum(tr.buy_in)");
    // The read model may report that legacy cache exists, but no D2B writer may derive or mutate truth from it.
    expect(normalized).not.toMatch(/\binsert\s+into\s+public\.series_event_actuals\b/);
    expect(normalized).not.toMatch(/\bupdate\s+public\.series_event_actuals\b/);
  });

  it("defines owner-only server functions pinned to empty search paths", () => {
    for (const name of ["series_promote_native_event_actual_v1", "series_reconcile_event_actual_v1", "series_get_decision_event_state_v1"]) {
      expect(normalized).toContain(`create or replace function public.${name}`);
      expect(normalized).toContain(`revoke all on function public.${name}`);
      expect(normalized).toContain(`grant execute on function public.${name}`);
    }
    const blocks = sql.split(/CREATE OR REPLACE FUNCTION/i).slice(1).filter((block) => /SECURITY DEFINER/i.test(block));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) expect(block).toMatch(/SET search_path = ''/i);
  });

  it("keeps D2B source-only with no UI, flags, direct grants, or live apply", () => {
    expect(normalized).not.toContain("supabase db push");
    expect(normalized).not.toContain("functions deploy");
    expect(normalized).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+to authenticated/);
    expect(normalized).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+to service_role/);
  });
});
