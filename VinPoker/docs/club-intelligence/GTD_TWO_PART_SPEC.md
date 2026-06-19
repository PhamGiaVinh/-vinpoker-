# VinPoker — GTD (Guarantee) Two-Part Design Spec

**Status:** Design proposal (docs-only). Nothing here is implemented, scheduled, or applied. Code/DB work
starts only after the owner approves this spec, in separate owner-gated sessions.
**Companion docs:** [`ROADMAP.md`](./ROADMAP.md) · [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md) · [`FULL_VERSION_SPEC.md`](./FULL_VERSION_SPEC.md) · [`DATA_MODEL.md`](./DATA_MODEL.md)

---

## 1. Why this spec exists

GTD (the tournament **guarantee** — the prize pool a tour promises) is currently **absent** from the
local schema, so every Series Intelligence surface reports **"thiếu GTD" (GTD missing)** and cannot assess
overlay. The owner clarified that GTD actually has **two distinct facets that belong to two different
modules**, so before touching any schema we write this spec to lock the model, the module boundaries, and
the phased rollout.

The two facets, in the owner's words:

- **Planned GTD** — *"1 tuần nữa, tôi là chủ tôi đặt GTD, tôi muốn nghiên cứu"*: ahead of time the owner
  sets a target/what-if GTD to **plan/study** a tour they're considering. It is a **planning hypothesis**,
  and it **may differ** from what is finally committed.
- **Committed GTD + actual** — *"GTD floor đặt, ví dụ 300M thì phải là cam kết 300M, thực tế 250M or bao
  nhiêu thì tự so sánh"*: the **floor** commits the real guarantee (e.g. 300M) when setting up the running
  tour; the **actual prize pool** (e.g. 250M, from real buy-ins) is compared against it →
  **overlay** = the gap the house covers.

> **One sentence:** Planned GTD is for *thinking* (Series Intelligence); Committed GTD + actual prize pool
> is for *operating* (Floor / Tracker / Cashier).

---

## 2. Module boundaries (locked)

| Facet | Owner of the surface | Nature |
|---|---|---|
| **Planned GTD** | **Series Intelligence** (Club Admin BI) | Forward/post-hoc, planning what-if, a *hypothesis* |
| **Committed GTD** | **Floor / Tracker** (operations) | The real commitment set at tour setup |
| **Actual prize pool** | **Cashier / registrations** | Real money in, from buy-ins |
| **Overlay (committed − actual)** | **Tracker / Floor** | Live operational coverage of the running tour |

Rules:
- The **DB column is a single shared truth**; SI and Tracker/Floor **read it differently** (SI for
  planning-risk, Tracker for live coverage). The column is not "owned" by SI.
- Series Intelligence is **post-hoc / forward BI** — it does **not** drive live operations. The real-time
  overlay of a *currently running* tour is a **Tracker/Floor** concern, never built inside the SI module.
- This split is consistent with the existing module ownership in [`ROADMAP.md`](./ROADMAP.md) and the
  product direction (business-ops modules stay separated).

---

## 3. Current data model (verified, read-only)

- **`tournaments` has no guarantee/GTD column.** (The `guarantee_usd` column found in the schema belongs
  to a *different* table, `international_events`, and is unrelated.)
- **`get_club_series_events`** (the SI read RPC) returns `gtd = null::numeric` as a deliberate placeholder
  — its own comment says a later PR adds the column and updates the function. GTD is never faked.
- **`prize_pool_actual` = the stored `tournaments.prize_pool`** column. It is **not confirmed** to be
  updated in real time from buy-ins (see §6 blocker). Entries come from `tournament_registrations`
  (`status = 'confirmed'`).
- Relevant `tournaments` columns today: `buy_in`, `rake_amount`, `service_fee_amount`, `prize_pool`,
  `current_players`, `players_remaining`, `itm_places`, `live_status`, `status`, `start_time`,
  `late_reg_close_level`, `free_rake_*`.
- Tournaments are **created / "floor set up"** in `src/components/floor/TournamentManagerPanel.tsx`
  (and bulk-created in `src/pages/BulkCreateTournaments.tsx`) — i.e. the floor write surface already lives
  in the Floor module.

---

## 4. Proposed data model + recommendation

### Recommended — Option 1 (single committed column; planned = transient what-if)
- Add one nullable column: **`tournaments.guarantee_amount numeric`** = the **committed** guarantee
  (the real cam kết, set by floor/owner at tour setup).
- **Series Intelligence reads it** via the RPC (returned as `gtd`).
- The owner's **planned / research GTD** is a **Series Intelligence scenario *what-if* override** —
  **transient, not persisted** (the owner types a number to study overlay scenarios; nothing is written to
  the DB).
- **`overlay = max(0, guarantee_amount − prize_pool_actual)`** — **derived**, never stored.

**Why Option 1 first:** it captures the one number that operations actually need (the commitment), keeps
the owner's planning fully flexible without a write path, and adds exactly one nullable column.

### Upgrade path — Option 2 (planned + committed persisted)
- Two columns: **`planned_guarantee`** (owner's persisted planning target) + **`guarantee_amount`**
  (committed/floor). More faithful to *"kế hoạch khác thực tế"* when the owner wants their planning number
  **saved** and compared to what the floor later commits.
- Cost: a second column + a second write path + the question of who can edit which.
- **Adopt only when** the owner truly needs a persisted planning-GTD workflow. Until then, Option 1's
  scenario what-if covers the planning need.

> Recommendation: **ship Option 1**, document Option 2 as the upgrade. This spec does not pick Option 2
> unless the owner asks.

---

## 5. Data flow

```
Owner (planning)        Floor (setup)            Cashier / registrations
     │                      │                            │
 plans a what-if       commits guarantee_amount     real buy-ins accumulate
 GTD in SI (transient) (e.g. 300M) on the tour      → prize_pool (actual)
     │                      │                            │
     ▼                      ▼                            ▼
 Series Intelligence    tournaments.guarantee_amount   tournaments.prize_pool
 scenario overlay-risk        (shared truth)            (actual, see §6 blocker)
 (planned vs projected)        │                            │
                               └──────────┬─────────────────┘
                                          ▼
                          Tracker/Floor overlay surface
                       overlay = max(0, committed − actual)
```

- **Who writes `guarantee_amount`:** the floor, in `TournamentManagerPanel` (Phase 3b). Owner may also
  set it at create — to be decided in §8.
- **Who updates `prize_pool` (actual):** cashier/registration flow — **to confirm** (§6).
- **SI read path:** `CREATE OR REPLACE get_club_series_events` to return `guarantee_amount as gtd`
  (Phase 3a). The SI adapter `src/lib/series-intelligence/nativeData.ts` then uses the real value instead
  of the hardcoded `null`.
- **Tracker overlay:** computes `committed − actual` for the running tour (Phase 3c).

---

## 6. ⚠️ Explicit blocker: `prize_pool` real-time

The "live overlay" of a running tour requires the **actual prize pool to update in real time** from
buy-in / registration / cashier events.

**Until it is confirmed (and, if missing, wired) that `tournaments.prize_pool` updates in real time:**

- The Tracker comparison MUST be labelled a **"stored prize-pool comparison"**, **NOT** "real-time
  coverage" / "live overlay".
- No surface may imply the overlay is live if the underlying prize pool is only set at creation.

Confirming/wiring real-time `prize_pool` (or computing it from confirmed registrations × (buy-in − rake))
is a **Phase 3c** Tracker/Floor/Cashier task, out of scope for the SI phase.

---

## 7. Honesty rules (binding for any GTD surface)

- **Planned GTD = hypothesis / planning**, never presented as a commitment.
- **Committed GTD = the real guarantee** (floor's cam kết).
- **`overlay = max(0, committed − actual)`** — derived, clamped at 0, never stored.
- **NULL guarantee still reports "thiếu GTD"** — the readiness/risk surfaces keep flagging it.
- **Never fake or infer GTD from `prize_pool`** (or from anything else).
- Until `prize_pool` real-time is confirmed → it is a **"stored prize-pool comparison", not live overlay**.
- Labels stay **Known Rule / Observed Pattern / Hypothesis** — **no `Model Estimate` / `Tested Finding`**,
  no prediction-as-certainty (consistent with [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md)).

---

## 8. Implementation phasing (recommended roadmap — NOT executed here)

Kept **module-clean**: no floor write UI inside the Series Intelligence phase.

### Phase 3a — Shared DB + Series Intelligence read path (owner-gated DB)
Controlled-apply split (per the controlled-ops model — never `db push` / `deploy_db` in CI):
1. **Source-only migration:** add `tournaments.guarantee_amount numeric NULL` + `CREATE OR REPLACE
   get_club_series_events` to return `guarantee_amount as gtd`. Source-only PR, no apply.
2. **Controlled live apply:** owner approval phrase → preflight → snapshot old RPC → apply via Management
   API (`db query --linked`) → golden verify (security/grants/owner-scope/gtd correct) → rollback note →
   **regen `types.ts`**.
3. **SI read-only frontend:** adapter `nativeData.ts` uses the real `gtd`; SI scenario/report surface GTD
   + overlay-**risk** against the **stored** prize_pool (planned what-if vs projected/stored). **No floor
   write UI in this phase.**

### Phase 3b — Floor/Tracker committed-GTD write path (separate owner-gated session)
- `TournamentManagerPanel` gains a GTD input; the floor commits the real `guarantee_amount`.
- Validation + audit (who set it, when) per production write-path discipline.

### Phase 3c — Tracker/Floor live overlay (separate session, gated on §6)
- Committed GTD vs **live** prize pool; first confirm/wire `tournaments.prize_pool` real-time updates.
- Until then it remains a **stored prize-pool comparison**, not a live overlay.

---

## 9. Open questions for the owner (resolve before Phase 3a code)

1. **Data model:** Option 1 (single `guarantee_amount` + SI what-if) — recommended — or Option 2 (persist
   `planned_guarantee` separately)?
2. **`prize_pool` real-time:** is `tournaments.prize_pool` updated live today, or only set at create? (If
   not live, Phase 3c must wire it.)
3. **Authority:** who is authoritative for the committed number — floor only, or owner-at-create + floor
   adjust at setup?
4. **Planned GTD persistence:** keep it a **transient** scenario what-if (Option 1), or persist it
   (Option 2) so the owner's pre-event plan is saved and later reconciled against the committed value?

---

## 10. What this spec is NOT

- Not a migration, not a schema change, not an RPC change, not types, not app code — **docs-only**.
- Not an approval to start Phase 3a/3b/3c — those are separate owner-gated sessions.
- Not a forecast or a prediction; GTD overlay is descriptive (committed vs actual), never a promise.
