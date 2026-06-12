# Seat Assignment → Floor Operations Module — Design & Handoff

> Session: **Seat Assignment and Floor Operations Session** (Session 4)
> Branch: `agent/seat-floor-tournament` · Date: 2026-06-12
> Status: PROPOSAL — every table/column/RPC marked **PROPOSED** does **not** exist yet.
> This session shipped frontend-only patches (TableDrawPanel, PrizeStructurePanel) + this doc. No DB/RPC/Edge changes.

---

## 1. Current Seat Assignment Flow

Two parallel systems exist today:

**A. Registration-driven seat assignment** (dev DB + `feat/cashier-tournament-registrations`):
1. Player registers online → `tournament_registrations` row (`pending`).
2. Cashier confirms via `confirm_registration_and_assign_seat(p_registration_id, p_actor_user_id, p_draw_mode)` — SECURITY DEFINER, tournament-level `FOR UPDATE` lock, idempotent re-confirm, actor guard (club owner OR `club_cashiers`), draw modes `random_balanced` / `fill_lowest_table`.
3. RPC writes `tournament_entries`, `tournament_seats` (partial unique indexes on active seats), `seat_draw_receipts`, `seat_assignment_history`; UI prints/PDFs the receipt (`SeatReceiptDialog`).
4. Moves go through `move_player_seat(p_entry_id, p_to_tournament_table_id, p_to_seat_number, p_actor_user_id, p_reason)` — actor-checked, same-seat idempotent, `seat_occupied` on conflict, supersedes receipts, history row.

**FK gotcha (critical for all future work):** `tournament_seats.table_id` → `tournament_tables.id`, while entries/receipts/history `table_id` → `game_tables.id`. Keep two variables (`v_table_tour_id` vs `v_table_game_id`).

**B. Live ops manual seating** (`TableDrawPanel` in Tournament Live, this branch): floor adds tables/players manually through the deployed `tournament-live-draw` edge function (`get_seats` / `add_table` / `add_player` / `update_seats`) — bulk-save model, no receipts, no history. After this session's patch: pending-changes UX, duplicate-seat guard, chip-conservation warning, active/inactive separation, balance hint.

These two systems are not yet reconciled; long-term, registration-driven flow (A) should feed live ops (B), and manual edits in (B) should write `seat_assignment_history`.

## 2. Floor Open-Table Workflow (PROPOSED)

Form: game type (NLH/PLO/tournament), stakes/blinds or tournament link, `max_seats` (default 9), optional assigned dealer (from Dealer Directory), initial status.

- Tournament tables: insert into `tournament_tables` (columns `table_number`, `max_seats`, `status` exist on dev DB) via **PROPOSED** RPC `open_tournament_table(p_tournament_id, p_table_number, p_max_seats, p_actor_user_id, p_reason)`.
- Cash tables (`game_tables`) are **Dealer Swing territory** — open via handoff contract, never direct writes from floor module (see §14/§16).
- Statuses: `active` / `waiting` / `private` / `tournament` (PROPOSED enum for game_tables; `tournament_tables.status` already has `active|closed|pending` semantics on dev DB — verify before reuse).

## 3. Floor Close-Table Workflow (PROPOSED)

`close_tournament_table(p_tournament_table_id, p_actor_user_id, p_reason)` — PROPOSED RPC, single transaction:
1. Validate no live hand on the table (integration with hand tracking when connected; until then a warning checkbox).
2. List active seats; require destination plan: auto-suggest via balancing (see §6), or send to waitlist (§5).
3. Move every active seat via the existing `move_player_seat` authority path (loop server-side, one lock).
4. Set table status `closed`, record reason + actor in `seat_assignment_history` (`action='close_table'` PROPOSED value).
5. Notify Tracker (realtime) + Cashier (toast/Telegram optional).

**Hard rule:** do NOT reuse Dealer Swing `close_table` RPC for tournament tables without a contract review — cash close touches dealer swing rotation, rake, and tracker table status; tournament close touches balancing, redraw, and active players. Different invariants, different RPCs (see §16).

## 4. Player Move Workflow (exists — extend)

`move_player_seat` RPC is live on dev DB (see §1A). Missing: floor UI. PROPOSED: move dialog in Tournament Live — pick entry → destination table (only `tournament_tables.id`!) → seat grid showing free seats → reason field (required) → RPC → toast + receipt supersede. The TableDrawPanel bulk-save move (this session) covers the manual-live-ops path; the RPC path is for registration-driven tournaments.

## 5. Waitlist Workflow (PROPOSED)

Table `tournament_waitlist` — PROPOSED:
`id uuid PK · tournament_id FK · player_id FK · source text ('registration'|'table_close'|'walk_in') · priority int · status text ('waiting'|'called'|'seated'|'cancelled') · created_at · called_at · seated_at · actor_id · note`.

Flow: join (cashier/registration/close-table) → FIFO within priority → floor "calls" (status `called`, push notification) → seat via `confirm_registration_and_assign_seat` or `move_player_seat` → `seated`. Cash-game waitlist is out of scope here (Dealer Swing/Cashier owns cash flow).

## 6. Table Balancing Workflow

- **Now (this session):** `suggestBalanceMove(tables, activeCounts)` — frontend-only, visibility-only hint in TableDrawPanel when active counts differ by >1. Suggests source/destination **table only, never a specific player** (no approved policy for picking who moves).
- **Phase 8 (planned):** `suggestTournamentBalance` TS helper — pure function over seats: returns ordered move suggestions (big-blind-next-to-move TDA convention PROPOSED as policy), applied manually one-by-one through `move_player_seat`. Never auto-executes.
- **TDA baseline:** balance when difference ≥ 2 (configurable per tournament — PROPOSED column `tournaments.balance_threshold`).

## 7. Multi-Day Tournament Design (PROPOSED)

Event → Days/Flights → Sessions model:

- `tournament_events` — PROPOSED: `id · club_id · name · starts_at · ends_at · status`.
- `tournament_flights` — PROPOSED: `id · event_id FK · tournament_id FK (one flight = one existing tournaments row, reuses ALL current live-ops machinery) · flight_code ('1A'|'1B'|'2'|'FINAL') · day_number · is_final bool · qualifies_to flight_id`.
- Day-end bagging: `tournament_bags` — PROPOSED: `id · flight_id · player_id · entry_number · chip_count · bag_photo_url · sealed_by · verified_by · created_at`. Bag count = authoritative carry-over stack for next day; double-sign (sealer + verifier).
- Day-start: seed next flight's `tournament_seats` from verified bags via PROPOSED RPC `seed_flight_from_bags`.
- Breaks: existing `tournament_levels.is_break` covers clock breaks; multi-day breaks are flight boundaries.
- Seat redraw: Phase 9 `final_table_redraw` RPC (planned) — full-table redraw at final, audited like moves.

## 8. Tournament Day/Session Model (PROPOSED)

A "floor day" record for ops accountability: `tournament_days` — PROPOSED: `id · event_id · day_number · opened_at · opened_by · closed_at · closed_by · tables_opened int · tables_closed int · disputes int · note`. Gives TD a daily open/close checklist and a place audits hang off. Lightweight: derive most numbers from history tables, store only the sign-offs.

## 9. Payout Input Workflow (PROPOSED — distinct from prize structure %)

`tournament_payouts` — PROPOSED:
`id uuid PK · tournament_id FK · position int · player_id FK · entry_number int · gross_amount numeric · withholding numeric default 0 · net_amount numeric · payment_status text ('pending'|'paid'|'held') · approval_status text ('draft'|'td_approved'|'owner_approved') · approved_by · paid_by · paid_at · audit_note text · created_at`.

Flow: eliminations/leaderboard prefill rank+player → cashier enters gross (prefill from `tournament_prizes` %) → TD approves → cashier marks paid (actor + timestamp). Every status change requires `actor_id` + note. **The current PrizeStructurePanel stays "dự kiến" (planned %) — payouts are a separate ledger, never inferred as paid.** Integration: payment itself stays in Cashier module (app records state, holds no money).

## 10. TDA Rule Search Design (PROPOSED)

`tda_rules` — PROPOSED:
`id · rule_source text ('TDA'|'HOUSE') · rule_version text · rule_number text · effective_year int · category text · title text · official_text text · house_override_text text · examples jsonb · created_at`.

- Versioned: TDA rules change by year; `house_override_text` lets the club deviate explicitly.
- Search: Postgres FTS (`to_tsvector` on title+official_text+examples) + category filter chips. UI: search box in floor panel, result links to §12 decision log ("áp dụng rule này" pre-fills the ruling form).
- Seeding: import from official TDA PDF (manual curation pass; licensing check before shipping text verbatim).

## 11. AI Floor Advisor Design (PROPOSED)

- Edge function `floor-advisor` — PROPOSED: input = situation description + tournament context (level, players, street); retrieval over `tda_rules` (FTS top-k) → LLM drafts suggested ruling + cited rule numbers + confidence.
- **Hard rule: AI never executes anything.** No table moves, rulings, payouts, penalties, eliminations. Suggest + draft reasoning only; a human TD/floor approves and executes, and the executed decision is recorded in §12 with `ai_assisted = true` + the suggestion snapshot.
- UI: "Trợ lý Floor" drawer — situation textarea → suggestion card (rule citations, confidence) → buttons "Ghi nhận ruling" (opens §12 form prefilled) / "Bỏ qua".

## 12. Dispute / Ruling Log Design (PROPOSED)

`floor_decisions` — PROPOSED:
`id · tournament_id FK · table_id (tournament_tables) · decision_type text ('ruling'|'penalty'|'dispute'|'note') · situation text · ruling text · rule_id FK tda_rules NULL · ai_assisted bool default false · ai_suggestion jsonb NULL · decided_by (TD/floor user) · involved_players uuid[] · status text ('recorded'|'appealed'|'overturned') · created_at`.

Every ruling searchable later (precedent), feeds dealer/floor training, and is the audit trail when players dispute payouts or penalties.

## 13. Integration Points

| Module | Integration | Direction |
|---|---|---|
| **Tracker (Live)** | table open/close + seat changes broadcast to `/live/:tournamentId`; tracker reads `tournament_seats` (already does) | floor → tracker (realtime) |
| **Cashier** | registrations tab confirm → seat + receipt (shipped on feat branch); payouts §9 mark-paid lives in cashier scope | bidirectional |
| **Tournament Registration** | `confirm_registration_and_assign_seat` is the single entry path for registered players; waitlist `source='registration'` | registration → floor |
| **Payroll** | none direct. Floor day record (§8) MAY later inform dealer hours — proposal only, never touch payroll formula | floor → payroll (read-only, future) |
| **Dealer Directory** | open-table dealer pick (§2) reads directory; assignment execution stays in Dealer Swing | directory → floor (read-only) |
| **Dealer Swing** | strict separation — see §16. Handoff doc required before any shared lifecycle | contract only |

## 14. Permission Model (PROPOSED)

- **Cashier** — view tournament ops; confirm registrations (existing guard); enter payout drafts.
- **Floor** — move seats, balance tables, open/close *tournament* tables, record rulings.
- **TD** — approve close-table, payouts, final-table redraw, rulings/penalties.
- **Owner/Admin** — override anything, but override requires an audit reason.

**Rule: every destructive/manual action requires `actor_id` + `reason`.** Enforced server-side in each PROPOSED RPC (pattern already set by `move_player_seat`). New role values (`floor`, `td`) are PROPOSED — today only owner/cashier exist in guards.

## 15. Chip-Conservation Audit Requirement

Any chip-mutating action (manual edit, bag verify, payout-driven adjustment) must be auditable: before/after totals, actor, reason. This session ships the client-side warning in TableDrawPanel (snapshot vs draft totals, explicit confirm, never auto-correct). PROPOSED server-side: `chip_audit_log` (`tournament_id · before_total · after_total · delta · action · actor_id · reason · created_at`) written inside `update_seats`-equivalent RPCs.

## 16. Tournament Table Lifecycle ≠ Dealer Swing Table Lifecycle

Future tournament open/close-table workflow **must not directly reuse Dealer Swing `close_table`** without a contract review. Cash-game close = dealer rotation, rake, tracker status invariants. Tournament close = balancing, redraw, active-player invariants. Shared concepts (a physical table) get a mapping (`tournament_tables.table_id → game_tables.id`), not shared mutation paths. Any cross-lifecycle need goes through a handoff doc in `docs/agent-handoffs/` for the Dealer Swing owner session.

## 17. Safe Patch Order

1. ✅ (this session) Frontend guards: TableDrawPanel safety + PrizeStructurePanel load/validation.
2. Move-player dialog UI over existing `move_player_seat` (no DB change).
3. `tournament_waitlist` migration + minimal join/call/seat UI.
4. `open_tournament_table` / `close_tournament_table` RPCs (+ history action values) — Controlled Production Patch Mode, preflight + rollback notes.
5. `tournament_payouts` migration + cashier input UI + TD approval.
6. Phase 8 `suggestTournamentBalance` helper + Phase 9 `final_table_redraw`.
7. Multi-day: events/flights/bags (+ `seed_flight_from_bags`).
8. `tda_rules` + FTS search UI.
9. `floor_decisions` log + ruling form.
10. AI floor advisor edge function (last — depends on 8 & 9).

Each DB step: new migration only, version-collision check, idempotent SQL, preflight + verification queries, rollback notes, one patch then stop.

## 18. Rollback Notes (this session)

Frontend/doc-only patch — no DB/RPC/Edge changes were made. Rollback = `git revert` of the commits on `agent/seat-floor-tournament` (or drop the branch before merge). No data migration, no deployed-function change, nothing to restore server-side.
