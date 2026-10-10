# Card integrity56 — evidence and release boundaries

Scope: two canonical card writers only; no app, Edge, flags or game-policy changes.

Predecessor normalized prosrc MD5:

- show_hole_cards(uuid,jsonb,uuid): 4f73608ff9d408b20be72dc4f88d6189
- update_community_cards(uuid,jsonb,uuid): 64734d09453c95918299ca3f6e3cc339

Expected new hashes: 8afab0698b5f9bba5c84b9318171990b and b29a4b0ba84cb967deb8276390b26ee4.
Metadata before/after: postgres, invoker, search_path=public, postgres/authenticated EXECUTE only.

Confirmed RED: valid first participant followed by invalid participant returned error after partial write; board accepted a card already in holes; SQL NULL envelope reported success.

Local evidence: focused PG17 attacks/NULL/both-order real lock overlap; captured-schema real Tracker/foreign actor/mismatch/anon/service calls, malformed batches, exact cards, source_revision and completed queue checks; readonly object postcheck. Fixtures rollback; focused helper stubs are not authority proof. Captured schema checksum d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a from capture run37820347781. Selected live revision/enqueue/session/correction trigger body hashes match capture; this is not full live parity.

Readonly critical review passed logic and metadata/test/CI delta, including the new full-schema overlap and deferred-mode fixture. Tightened missing-blocker assertion to reject SQL NULL. Catalog/control/credential/static promotion/lint, full tsc-b and build passed on the prior source. Prior head38913 exact CI38091472553 succeeded; new test delta requires fresh exact-head CI.

Current-schema authenticated both-order overlap passed on an isolated clone with real Tracker role/RLS/triggers: holder ClientRead with transaction, waiter Lock before commit, first success and second card_already_used. Resets target only fixture hand/players. Owner mode request uses actual fixture revision/epoch, remains pending during hand, synthetic completion and deferred callback flush apply manual/epoch+1. Old completed-hand card calls deny without hand/queue delta. This is not canonical finish or Voice acceptance.

Outstanding: stale-session/epoch and Voice wrapper regression, latest affected dependency parity, fresh restorable recovery point, exact atomic allowlist runner/ledger receipt and rollback rehearsal, authorized scoped web acceptance. Draft is NOT RELEASE READY until these requirements are qualified. Do not broadly push the migration catalog or disable guards.

Recovery: capture reviewed pre-56 function definitions and authority metadata in private recovery storage, restore them only through a new compensating migration after approval. This fixes function definitions, not poker data: never undo validated card writes or rewrite history. Record source hash, recovery snapshot time and postcheck. Function postcheck does not substitute for migration ledger receipt verification.
