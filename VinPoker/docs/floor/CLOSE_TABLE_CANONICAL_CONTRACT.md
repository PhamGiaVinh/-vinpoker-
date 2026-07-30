# Close Table Canonical Contract

Status: owner-locked source contract. This document and its migration do not
apply SQL, repair migration history, deploy code, or operate on a live table.

## Historical Boundary

The live `close_tournament_table(uuid,text,text)` body matches
`20261240000000_floor_production_hardening.sql`. The historical
`20270101000000_close_tournament_table_containment.sql` body is not canonical:
it is absent from the live ledger and changes authorization, mismatch handling,
already-closed behavior, and dealer release.

The forward migration preserves live business behavior and adds only the
approved table-local safety delta. It does not edit or rename either historical
migration and does not insert or repair ledger rows.

## Authorization And Identity

- The actor is always `auth.uid()`.
- Club owner, authorized club cashier, or `is_club_floor(actor, club_id)` may
  close the table.
- Tracker-only and ChipMaster-only users are not authorized.
- `p_tournament_table_id` is always `tournament_tables.id`.
- Legacy seat rows may reference either that canonical ID or the server-derived
  physical `game_tables.id`; callers cannot send the physical ID.

## Shared Table Seam

The function uses the same transaction advisory key as the current mode,
start, and bust writers:

```sql
pg_advisory_xact_lock(
  hashtext(tournament_id::text),
  hashtext(tournament_table_id::text)
)
```

After the lock it re-reads the canonical table and blocks an in-progress hand
on either canonical or physical table identity with `table_has_active_hand`.
It never voids or deletes hand evidence.

## Fail-Closed Guards

- An active source seat with `entry_id IS NULL` returns
  `UNLINKED_ACTIVE_SEATS` plus source counts and chip total.
- A non-null link that is missing or mismatches tournament, player, entry
  number, or seated status returns `seat_entry_mismatch`.
- Both guards run before seat, entry, receipt, history, table, game-table, or
  dealer writes.
- Insufficient destination capacity remains a structured zero-write result.

## Preserved Outcomes

- Already closed remains idempotent success with `moved_count: 0`.
- Empty tables close with a complete receipt, release their dealer, and mark
  the physical table inactive.
- Draw modes, destination selection, unique-seat retry, seat movement, entry
  projection, receipt superseding/issuance, assignment history, metadata, and
  final dealer release preserve the live contract.
- Populated success requires a complete move receipt.

## Operation-Local Conservation

The transaction snapshots only source movers and proves:

- the source table has no residual active seat;
- result count equals mover count;
- every mover entry has exactly one active destination seat;
- mover identity and chip value are unchanged;
- entry seat/table/current-stack projections match the destination;
- every mover has the receipt and history rows created by this operation.

The function intentionally does not compare unrelated tournament seats.
Whole-tournament conservation is deferred until PR2A places all
context-affecting writers under a common tournament lock.

## Security And Rollout

The function remains `SECURITY DEFINER`, owned by `postgres`, with
`search_path = public`. `PUBLIC` and `anon` are revoked; existing
`authenticated` and `service_role` grant parity is explicit.

Production application, rollback, live smoke testing, and PR2A remain separate
owner-gated sessions.
