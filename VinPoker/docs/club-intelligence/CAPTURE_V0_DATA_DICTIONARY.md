# CAPTURE v0 — Data Dictionary

Source-of-truth definitions for the Series Intelligence **capture layer** (migration
`20261125000000_series_capture_v0.sql`). **Infrastructure only — no model, no prediction.**

> **Source-only.** The migration is NOT applied in the PR that adds it. The owner reads this SQL and
> applies it later in a controlled session, then regenerates `types.ts` in a separate step.

## Field role legend (leakage discipline)
Every column is tagged by its role in the learning loop:
- **PRE** — known BEFORE the event → may be a future forecast **input**.
- **DEC** — a decision / action recorded at a horizon.
- **POST** — measured AFTER the event → **scoring-only target**. **NEVER use a POST field as a forecast
  input** (that would be leakage). POST fields exist to score forecast-vs-actual later.
- **META** — bookkeeping (ids, timestamps, provenance).

Horizons everywhere use the same vocabulary: `T-21 · T-7 · T-1 · T-0` (and `post` for decision logs).
All tables are **owner-scoped** (RLS `is_club_owner`), `club_id` denormalized for join-free RLS.

---

## `series_forecast_snapshots` — a forecast recorded BEFORE an event (for later accuracy scoring)
> **v0 is schema-only.** This PR creates the table but adds **no write path**. The forecast layer
> (`turnoutForecast` / scenario — a separate, unmerged PR) will write snapshots later. Immutable once
> written (no UPDATE grant): a snapshot is a frozen record of what was forecast at a horizon.

| Column | Type | Role | Meaning |
|---|---|---|---|
| id | uuid | META | PK |
| club_id | uuid | META | owning club (FK clubs) |
| event_id | uuid | META | the tournament being forecast (FK tournaments) |
| horizon | text | META | `T-21/T-7/T-1/T-0` — how far before the event |
| days_before | int | META | optional exact days before |
| forecast_base | int | PRE-output | predicted entries (point) |
| forecast_low / forecast_high | int | PRE-output | p10/p90 band (`low ≤ base ≤ high`) |
| confidence_tier | text | META | `low/medium/high` — by sample size |
| candidate_gtd | bigint | PRE | the GTD being considered (VND) |
| overlay_risk_pct | numeric | PRE-output | P(overlay) at this GTD (0–100) |
| source_label | text | META | provenance, e.g. `turnout-forecast` / `scenario` |
| notes | text | META | free text |
| created_at / created_by | ts / uuid | META | |

## `series_decision_logs` — recommended vs decision vs public action + post-event outcome (the loop spine)
> SELECT + INSERT + UPDATE (owner fills POST fields after the event via UPDATE).

| Column | Type | Role | Meaning |
|---|---|---|---|
| id, club_id, event_id | uuid | META | keys |
| forecast_snapshot_id | uuid (NULL) | META | which snapshot the owner SAW before deciding (FK, SET NULL) |
| decision_horizon | text | DEC | `T-21/T-7/T-1/T-0/post` |
| recommended_action | text | DEC | what the system/advisor suggested |
| owner_decision | text | DEC | what the owner actually decided |
| public_action | text | DEC | what was published to players |
| decision_reason | text | DEC | why |
| actual_result | text | **POST** | free-text outcome note |
| actual_entries | int | **POST** | real total entries (scoring target) |
| actual_unique_players | int | **POST** | real unique players |
| actual_reentries | int | **POST** | real re-entries |
| actual_prize_pool | bigint | **POST** | real prize pool (VND) |
| actual_overlay_amount | bigint | **POST** | real overlay the club covered (VND) |
| post_event_reason | text | **POST** | post-mortem note |
| created_at / created_by | | META | |

## `series_campaign_logs` — marketing campaign log
| Column | Type | Role | Meaning |
|---|---|---|---|
| id, club_id | uuid | META | keys |
| campaign_id | text | META | external/internal campaign id |
| event_linked | uuid (NULL) | META | tournament this campaign targets (optional, FK SET NULL) |
| channel | text | DEC | facebook / zalo / telegram / … |
| spend | bigint | DEC | spend (VND, ≥0) |
| creative_type | text | DEC | video / image / text … |
| target_segment | text | DEC | who it targeted |
| baseline_expected_entries | int | PRE | the pre-campaign expectation (≥0) — context, not a forecast claim |
| decision_reason | text | DEC | why this campaign |

## `series_registration_events` — per-registration capture (funnel + unique/re-entry source)
> SELECT + INSERT only (append-only event stream).

| Column | Type | Role | Meaning |
|---|---|---|---|
| id, club_id, event_id | uuid | META | keys |
| **player_ref_hash** | text | PRE | **opaque/HASHED player reference — see privacy lock below** |
| **player_ref_type** | text | META | what KIND was hashed: `phone` / `app_user_id` / `host_label` |
| registered_at | ts | PRE | when they registered (default now) |
| is_reentry | bool | PRE | this row is a re-entry (vs first bullet) |
| bullet | smallint | PRE | bullet number (≥1) |
| commitment_stage | text | PRE | `interested / reserved / paid / seated / cancelled` (the funnel) |
| entry_source | text | PRE | `direct / online / floor / satellite / unknown` |

### `player_ref_type` conventions (so the SAME person reconciles later)
- **`phone`** — `player_ref_hash` = a strong hash of the normalized phone number. Reconcile two rows as the
  same person when the hashes match. The raw phone is NEVER stored.
- **`app_user_id`** — the hash (or the value) of the VinPoker app user id, when the player is an app user.
- **`host_label`** — a host-assigned opaque label for a walk-in with no phone/app id (e.g. a per-club code).
Mixing types is fine across rows; reconciliation is within a `(player_ref_type, player_ref_hash)` pair.

### 🔒 Privacy lock (binding)
`player_ref_hash` **MUST be hashed / opaque**. **NEVER** store a raw phone, name, Telegram/Facebook handle,
ID-card number, or any personal identifier in this column (or anywhere in these tables). The schema captures
*that two registrations are the same person*, not *who* the person is.
