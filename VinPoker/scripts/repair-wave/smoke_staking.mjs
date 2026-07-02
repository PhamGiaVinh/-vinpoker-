#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// REPAIR WAVE R3 — staking Edge smoke suite (fixture data, self-cleaning)
// ════════════════════════════════════════════════════════════════════════════
// Runs AFTER the 3 functions deploy. Creates throwaway users + an isolated fixture club/deal,
// walks the money paths through the REAL deployed functions with REAL JWTs, asserts every
// invariant, then deletes everything it created (scoped deletes only).
//
// Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (if any is missing the script SKIPS with exit 0 and a loud warning — deploy proof is separate).
//
// Matrix:
//   T1  no-role user calls admin-confirm-funded            → 403
//   T2  cashier NOT assigned to the club calls it          → 403
//   T3  super admin confirms purchase                      → success; purchase=funded; deal=funded;
//                                                            exactly ONE fund_lock ledger row
//   T4  double-click confirm                               → already:true; STILL one fund_lock row
//   T5  requester cosigns own release (non-cashier admin)  → 403 (two-person control)
//   T6  second super admin cosigns                         → request=approved (trigger), deal=cosigned
//   T7  refund a cosigned deal                             → 4xx (refund/release mutual exclusion)
//   T8  refund a funded deal (fresh deal #2)               → success; deal=deal_refunded;
//                                                            purchase=refunded; ONE refund ledger row
//   T9  refund again                                       → 409 (no double refund)
//   T10 confirm-funded on the refunded purchase            → 409
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) {
  console.warn("[smoke] SKIPPED — SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not all set.");
  console.warn("[smoke] Add them as GitHub Secrets and re-run the staking-edge workflow to execute the smoke suite.");
  process.exit(0);
}

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const TAG = `smoke-${Date.now().toString(36)}`;
const cleanup = { users: [], clubs: [], deals: [] };
let failures = 0;

const ok = (name, cond, detail = "") => {
  console.log(`[smoke] ${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
};

async function makeUser(label, role) {
  const email = `${TAG}-${label}@smoke.vbacker.test`;
  const password = `Sm0ke!${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  cleanup.users.push(data.user.id);
  if (role) {
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: data.user.id, role });
    if (rErr) throw new Error(`role ${role} for ${label}: ${rErr.message}`);
  }
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  return { id: data.user.id, jwt: sess.session.access_token, email };
}

async function callFn(name, jwt, body) {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function countLedger(dealId, type) {
  const { count } = await admin.from("escrow_transactions")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId).eq("transaction_type", type);
  return count ?? 0;
}

async function makeDeal(club, player, backer, status = "committing") {
  const { data: deal, error } = await admin.from("staking_deals").insert({
    player_id: player.id, club_id: club, status,
    percentage_sold: 20, markup: 1.0, buy_in_amount_vnd: 5_000_000,
    custom_event_name: `${TAG} fixture`,
  }).select("id").single();
  if (error) throw new Error(`deal insert: ${error.message}`);
  cleanup.deals.push(deal.id);
  const { data: purchase, error: pErr } = await admin.from("staking_purchases").insert({
    deal_id: deal.id, backer_id: backer.id, percent: 20, amount_vnd: 1_000_000,
    status: "committed", reference_code: `${TAG}-${deal.id.slice(0, 6)}`,
  }).select("id").single();
  if (pErr) throw new Error(`purchase insert: ${pErr.message}`);
  return { dealId: deal.id, purchaseId: purchase.id };
}

async function main() {
  console.log(`[smoke] tag=${TAG}`);
  // ---- fixtures ----
  const superA = await makeUser("supera", "super_admin");
  const superB = await makeUser("superb", "super_admin");
  const cashierX = await makeUser("cashierx", "cashier"); // cashier role, NOT assigned to the club
  const backer = await makeUser("backer", null);
  const player = await makeUser("player", null);

  const { data: club, error: cErr } = await admin.from("clubs").insert({
    name: `${TAG} club`, status: "approved", owner_id: superA.id, city: "Smoke",
  }).select("id").single();
  if (cErr) throw new Error(`club insert: ${cErr.message}`);
  cleanup.clubs.push(club.id);

  const d1 = await makeDeal(club.id, player, backer);

  // ---- T1 no-role actor forbidden ----
  let r = await callFn("admin-confirm-funded", backer.jwt, { purchase_id: d1.purchaseId });
  ok("T1 no-role forbidden", r.status === 403, `status=${r.status}`);

  // ---- T2 cashier of another club forbidden ----
  r = await callFn("admin-confirm-funded", cashierX.jwt, { purchase_id: d1.purchaseId });
  ok("T2 unassigned cashier forbidden", r.status === 403, `status=${r.status} ${JSON.stringify(r.json)}`);

  // ---- T3 confirm funded happy path ----
  r = await callFn("admin-confirm-funded", superA.jwt, { purchase_id: d1.purchaseId, bank_tx_id: `${TAG}-tx1` });
  const { data: p1 } = await admin.from("staking_purchases").select("status").eq("id", d1.purchaseId).single();
  const { data: dl1 } = await admin.from("staking_deals").select("status").eq("id", d1.dealId).single();
  ok("T3 confirm success", r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
  ok("T3 purchase funded", p1?.status === "funded", p1?.status);
  ok("T3 deal funded (full fill 20/20)", dl1?.status === "funded", dl1?.status);
  ok("T3 exactly one fund_lock", (await countLedger(d1.dealId, "fund_lock")) === 1);

  // ---- T4 double click ----
  r = await callFn("admin-confirm-funded", superA.jwt, { purchase_id: d1.purchaseId });
  ok("T4 idempotent already:true", r.status === 200 && r.json?.already === true, JSON.stringify(r.json));
  ok("T4 still one fund_lock", (await countLedger(d1.dealId, "fund_lock")) === 1);

  // ---- release request fixture (requested by superA) ----
  await admin.from("staking_deals").update({ status: "release_requested" }).eq("id", d1.dealId);
  const { data: rr, error: rrErr } = await admin.from("staking_release_requests").insert({
    deal_id: d1.dealId, requested_by_admin_id: superA.id, status: "pending_cosign",
  }).select("id").single();
  if (rrErr) throw new Error(`release request insert: ${rrErr.message}`);

  // ---- T5 same-admin cosign forbidden ----
  r = await callFn("staking-cosign-release", superA.jwt, { release_request_id: rr.id });
  ok("T5 self-cosign forbidden (non-cashier admin)", r.status === 403, `status=${r.status} ${JSON.stringify(r.json)}`);

  // ---- T6 second admin cosigns ----
  r = await callFn("staking-cosign-release", superB.jwt, { release_request_id: rr.id });
  const { data: rrNow } = await admin.from("staking_release_requests").select("status, cosigned_by_admin_id").eq("id", rr.id).single();
  const { data: dl1b } = await admin.from("staking_deals").select("status").eq("id", d1.dealId).single();
  ok("T6 cosign success", r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
  ok("T6 request approved via trigger", rrNow?.status === "approved", rrNow?.status);
  ok("T6 deal cosigned", dl1b?.status === "cosigned", dl1b?.status);

  // ---- T7 refund a cosigned deal must be blocked (mutual exclusion) ----
  r = await callFn("staking-process-refund", superA.jwt, { deal_id: d1.dealId, reason: `${TAG} exclusion test` });
  ok("T7 refund blocked on cosigned deal", r.status >= 400, `status=${r.status} ${JSON.stringify(r.json)}`);

  // ---- T8 refund happy path on fresh funded deal ----
  const d2 = await makeDeal(club.id, player, backer);
  await callFn("admin-confirm-funded", superA.jwt, { purchase_id: d2.purchaseId });
  r = await callFn("staking-process-refund", superA.jwt, { deal_id: d2.dealId, reason: `${TAG} refund test` });
  const { data: dl2 } = await admin.from("staking_deals").select("status, refund_status, refunded_by").eq("id", d2.dealId).single();
  const { data: p2 } = await admin.from("staking_purchases").select("status").eq("id", d2.purchaseId).single();
  ok("T8 refund success", r.status === 200 && r.json?.success === true && r.json?.refunded_backers === 1, JSON.stringify(r.json));
  ok("T8 deal deal_refunded", dl2?.status === "deal_refunded", dl2?.status);
  ok("T8 purchase refunded", p2?.status === "refunded", p2?.status);
  ok("T8 exactly one refund ledger row", (await countLedger(d2.dealId, "refund")) === 1);
  ok("T8 zero ledger failures", (r.json?.ledger_failures ?? 0) === 0);

  // ---- T9 double refund blocked ----
  r = await callFn("staking-process-refund", superA.jwt, { deal_id: d2.dealId, reason: `${TAG} double refund` });
  ok("T9 double refund blocked", r.status === 409, `status=${r.status} ${JSON.stringify(r.json)}`);
  ok("T9 still one refund ledger row", (await countLedger(d2.dealId, "refund")) === 1);

  // ---- T10 confirm-funded on refunded purchase blocked ----
  r = await callFn("admin-confirm-funded", superA.jwt, { purchase_id: d2.purchaseId });
  ok("T10 confirm on refunded purchase blocked", r.status === 409, `status=${r.status} ${JSON.stringify(r.json)}`);
}

async function cleanupAll() {
  console.log("[smoke] cleanup…");
  for (const dealId of cleanup.deals) {
    await admin.from("staking_release_requests").delete().eq("deal_id", dealId);
    await admin.from("staking_audit_logs").delete().eq("deal_id", dealId);
    await admin.from("escrow_transactions").delete().eq("deal_id", dealId);
    await admin.from("staking_purchases").delete().eq("deal_id", dealId);
    await admin.from("staking_deals").delete().eq("id", dealId);
  }
  for (const uid of cleanup.users) {
    await admin.from("notifications").delete().eq("user_id", uid);
    await admin.from("user_roles").delete().eq("user_id", uid);
  }
  for (const clubId of cleanup.clubs) await admin.from("clubs").delete().eq("id", clubId);
  for (const uid of cleanup.users) await admin.auth.admin.deleteUser(uid).catch(() => {});
  console.log(`[smoke] cleanup done: ${cleanup.deals.length} deals, ${cleanup.clubs.length} clubs, ${cleanup.users.length} users removed.`);
}

try {
  await main();
} catch (e) {
  failures++;
  console.error("[smoke] ABORTED:", e?.message ?? e);
} finally {
  try { await cleanupAll(); } catch (e) { console.error("[smoke] cleanup error:", e?.message); }
}
if (failures) { console.error(`[smoke] ${failures} FAILURE(S)`); process.exit(1); }
console.log("[smoke] ALL PASS");
