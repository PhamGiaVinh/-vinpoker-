// Deterministic tests for featureTableGate.ts's 3 gate helpers — happy paths (unchanged
// behavior) + the P2 hardening fix (full-system audit, 2026-07-02): a query error must
// fail CLOSED (never silently degrade to "gate inactive" / "reserved set empty").
//
// Run: deno test supabase/functions/_shared/__tests__/featureTableGate.test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  getFeatureTablePoolIds,
  getFeatureTablePoolsByTable,
  getReservedDealerIds,
} from "../featureTableGate.ts";

type Row = Record<string, unknown>;
type Err = { message: string } | null;
type Resp = { data: unknown; error: Err };

// Minimal table-routed mock. Each of the 3 functions under test issues exactly one query
// per table name (app_settings / dealer_table_profiles / dealer_table_pool_members) —
// .maybeSingle() and the plain thenable share ONE per-table responder, since no test here
// needs to distinguish by filter args, only by which TABLE the query hit.
function makeAdmin(fix: {
  appSettings: Resp;
  dealerTableProfiles: Resp;
  dealerTablePoolMembers: Resp;
}) {
  const CHAIN_METHODS = ["select", "eq", "in", "or", "not", "gt"] as const;
  function builder(table: string) {
    const resolve = (): Resp => {
      if (table === "app_settings") return fix.appSettings;
      if (table === "dealer_table_profiles") return fix.dealerTableProfiles;
      if (table === "dealer_table_pool_members") return fix.dealerTablePoolMembers;
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const m of CHAIN_METHODS) chain[m] = () => chain;
    chain.maybeSingle = () => Promise.resolve(resolve());
    // deno-lint-ignore no-explicit-any
    chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (table: string) => builder(table) } as any;
}

const KS_ON: Resp = { data: { value: true }, error: null };
const KS_OFF: Resp = { data: { value: false }, error: null };
const NONE: Resp = { data: null, error: null };
const ERR = { message: "simulated transient DB error" };

// ══════════════════════════════════════════════════════════════════════════
// getFeatureTablePoolIds — single-table reactive gate
// ══════════════════════════════════════════════════════════════════════════

Deno.test("getFeatureTablePoolIds happy path: special table + 2 pool members → Set of 2", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: { table_mode: "feature", is_final: null }, error: null },
    dealerTablePoolMembers: { data: [{ dealer_id: "d1" }, { dealer_id: "d2" }], error: null },
  });
  const result = await getFeatureTablePoolIds(admin, "T1");
  assert(result !== null);
  assertEquals([...result!].sort(), ["d1", "d2"]);
});

Deno.test("getFeatureTablePoolIds unchanged: kill-switch OFF → null (no query error)", async () => {
  const admin = makeAdmin({ appSettings: KS_OFF, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  assertEquals(await getFeatureTablePoolIds(admin, "T1"), null);
});

Deno.test("getFeatureTablePoolIds unchanged: kill-switch ON + normal table → null (no query error)", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: null, error: null }, // no profile row → not special
    dealerTablePoolMembers: NONE,
  });
  assertEquals(await getFeatureTablePoolIds(admin, "T1"), null);
});

Deno.test("getFeatureTablePoolIds P2 fix: app_settings error → fails CLOSED (empty Set, NOT null)", async () => {
  const admin = makeAdmin({ appSettings: { data: null, error: ERR }, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  const result = await getFeatureTablePoolIds(admin, "T1");
  assert(result !== null, "must NOT return null (null = gate inactive = fail-OPEN)");
  assertEquals(result!.size, 0);
});

Deno.test("getFeatureTablePoolIds P2 fix: dealer_table_profiles error → fails CLOSED (empty Set, NOT null)", async () => {
  const admin = makeAdmin({ appSettings: KS_ON, dealerTableProfiles: { data: null, error: ERR }, dealerTablePoolMembers: NONE });
  const result = await getFeatureTablePoolIds(admin, "T1");
  assert(result !== null);
  assertEquals(result!.size, 0);
});

Deno.test("getFeatureTablePoolIds P2 fix: dealer_table_pool_members error → fails CLOSED (empty Set, NOT null)", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: { table_mode: "feature", is_final: null }, error: null },
    dealerTablePoolMembers: { data: null, error: ERR },
  });
  const result = await getFeatureTablePoolIds(admin, "T1");
  assert(result !== null);
  assertEquals(result!.size, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// getFeatureTablePoolsByTable — batched proactive-planner gate
// ══════════════════════════════════════════════════════════════════════════

Deno.test("getFeatureTablePoolsByTable happy path: 1 special table with members, 1 normal (absent)", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: [{ table_id: "T1", table_mode: "feature", is_final: null }], error: null },
    dealerTablePoolMembers: { data: [{ table_id: "T1", dealer_id: "d1" }], error: null },
  });
  const result = await getFeatureTablePoolsByTable(admin, ["T1", "T2"]);
  assertEquals([...result.get("T1")!].sort(), ["d1"]);
  assertEquals(result.has("T2"), false); // T2 not special → absent → ungated downstream
});

Deno.test("getFeatureTablePoolsByTable unchanged: kill-switch OFF → empty Map (no query error)", async () => {
  const admin = makeAdmin({ appSettings: KS_OFF, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  const result = await getFeatureTablePoolsByTable(admin, ["T1", "T2"]);
  assertEquals(result.size, 0);
});

Deno.test("getFeatureTablePoolsByTable P2 fix: app_settings error → EVERY requested table gated+empty", async () => {
  const admin = makeAdmin({ appSettings: { data: null, error: ERR }, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  const result = await getFeatureTablePoolsByTable(admin, ["T1", "T2"]);
  assertEquals(result.size, 2, "both requested tables must be present (gated), not silently absent (ungated)");
  assertEquals(result.get("T1")!.size, 0);
  assertEquals(result.get("T2")!.size, 0);
});

Deno.test("getFeatureTablePoolsByTable P2 fix: dealer_table_profiles error → EVERY requested table gated+empty", async () => {
  const admin = makeAdmin({ appSettings: KS_ON, dealerTableProfiles: { data: null, error: ERR }, dealerTablePoolMembers: NONE });
  const result = await getFeatureTablePoolsByTable(admin, ["T1", "T2"]);
  assertEquals(result.size, 2);
  assertEquals(result.get("T1")!.size, 0);
  assertEquals(result.get("T2")!.size, 0);
});

Deno.test("getFeatureTablePoolsByTable P2 fix: dealer_table_pool_members error → only the already-known special tables stay gated+empty", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: [{ table_id: "T1", table_mode: "feature", is_final: null }], error: null },
    dealerTablePoolMembers: { data: null, error: ERR },
  });
  const result = await getFeatureTablePoolsByTable(admin, ["T1", "T2"]);
  assertEquals(result.get("T1")!.size, 0, "T1 (known special) stays gated+empty, not populated");
  assertEquals(result.has("T2"), false, "T2 was already confirmed normal — no need to also gate it");
});

// ══════════════════════════════════════════════════════════════════════════
// getReservedDealerIds — cross-table exclusivity set
// ══════════════════════════════════════════════════════════════════════════

Deno.test("getReservedDealerIds happy path: 1 special table with 2 members → Set of 2", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: [{ table_id: "T1" }], error: null },
    dealerTablePoolMembers: { data: [{ dealer_id: "d1" }, { dealer_id: "d2" }], error: null },
  });
  const result = await getReservedDealerIds(admin);
  assertEquals([...result].sort(), ["d1", "d2"]);
});

Deno.test("getReservedDealerIds unchanged: kill-switch OFF → empty Set, no throw", async () => {
  const admin = makeAdmin({ appSettings: KS_OFF, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  const result = await getReservedDealerIds(admin);
  assertEquals(result.size, 0);
});

Deno.test("getReservedDealerIds P2 fix: app_settings error → THROWS (never returns a false-empty Set)", async () => {
  const admin = makeAdmin({ appSettings: { data: null, error: ERR }, dealerTableProfiles: NONE, dealerTablePoolMembers: NONE });
  await assertRejects(() => getReservedDealerIds(admin));
});

Deno.test("getReservedDealerIds P2 fix: dealer_table_profiles error → THROWS", async () => {
  const admin = makeAdmin({ appSettings: KS_ON, dealerTableProfiles: { data: null, error: ERR }, dealerTablePoolMembers: NONE });
  await assertRejects(() => getReservedDealerIds(admin));
});

Deno.test("getReservedDealerIds P2 fix: dealer_table_pool_members error → THROWS", async () => {
  const admin = makeAdmin({
    appSettings: KS_ON,
    dealerTableProfiles: { data: [{ table_id: "T1" }], error: null },
    dealerTablePoolMembers: { data: null, error: ERR },
  });
  await assertRejects(() => getReservedDealerIds(admin));
});
