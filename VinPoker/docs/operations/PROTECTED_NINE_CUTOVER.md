# Protected nine migration cutover (owner-only)

Status: source-only. Daybreak, DB apply, Edge deploy, frontend deploy and every production flag remain OFF. This runbook never authorizes production work by itself.

## Frozen identities

Use only `.github/workflows/protected-nine-exact-apply.yml` on `main`, with the reviewed release SHA, exact project `orlesggcjamwuknxwcpk`, exact filename and normalized hash from `supabase/migration-control/manifest.json`. One dispatch applies one entry. Never use the unrelated Ops 1359 42-entry manifest, broad `db push`, ledger repair, receipt deletion or migration rewriting.

Before every entry: owner approval; fresh recovery workflow (snapshot no older than one hour, encrypted artifact present, isolated restore PASS); no competing release; exact live ledger names; dependencies and previous postchecks PASS. After every entry: archive workflow receipt, check migration-specific object/ACL result, confirm flags remain OFF, then STOP for owner review.

## Ordered cutover and stop gates

1. `00001` Dealer Swing DB containment. Postcheck, then deploy exactly the reviewed SHA of `process-swing`, `mass-assign`, and `checkout-dealer` through the protected Edge process. Smoke auth/session binding with TEST actors only. STOP if any function SHA/version, auth result or log differs; do not mutate any named live dealer or table.
2. `00002` TV Stage A guarded RPCs. Deploy a compatible frontend exact SHA, perform authenticated owner UAT for save/read/branding, record that SHA and `PASS`. **HOLD.** Do not dispatch `00003` without both attestations.
3. `00003` TV Stage B direct-write revoke. Confirm the same frontend SHA is deployed and authenticated UAT still passes; postcheck authenticated direct UPDATE and legacy RPC execution are revoked. STOP.
4. `00004` History queue foundation. Keep worker/feature OFF; verify queue/RLS/trigger/RPC ACL. STOP.
5. `00005` correction authority. Keep correction flag OFF; verify tenant/actor authority using TEST data. STOP.
6. `00006` history audit fixes. Keep dispatcher OFF; verify immutable snapshot/receipt and public-history ACL. STOP.
7. `00007` Floor V3 consistency. Keep Floor V3 flag OFF; verify inventory/roster/planner/writer ACL and no seat/chip mutation. STOP.
8. `00008` Tracker Voice authority. Keep Voice/Telegram mutation OFF; verify exact live predecessor digest and TEST authorization. STOP.
9. `00009` history reparent invalidation. Keep worker OFF; verify revision triggers without rewriting historical receipts. STOP.

## Forward-only containment

The exact per-entry containment action and postcheck SQL live in `scripts/ops/protected-nine-postchecks.json`. On any failure or unknown acknowledgement: stop consumers/keep flags OFF, preserve receipts and audit data, collect metadata-only evidence, and create a new reviewed forward migration. A database restore is only an owner data-loss decision after assessing intervening writes; it is never automatic.
