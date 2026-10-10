-- CLI-created20261010091911; reserved forward46 after source/live ledger36 check.
-- Canonical Floor open uses game_table_id; legacy table_id may legitimately be NULL.
-- Do not accept a non-NULL legacy cross-link or infer a session from physical table.
-- ROLLBACK: keep automatic acquisition OFF; restore captured function definition
-- only after affected consumers are rolled back. No row/history repair is performed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE definition text; needle text := 'OR tt.table_id IS DISTINCT FROM g.id OR tt.tournament_id IS DISTINCT FROM s.tournament_id';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid=to_regprocedure('floor_private.club_operational_inventory(uuid)')
     AND md5(replace(p.prosrc,chr(13),''))='310a2f467439dbfbd92e1601fed2159a'
     AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND r.rolname='postgres') THEN
   RAISE EXCEPTION 'dealer_inventory_canonical_link_precondition_drift';
 END IF;
 SELECT replace(pg_get_functiondef(to_regprocedure('floor_private.club_operational_inventory(uuid)')),chr(13),'') INTO definition;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
   RAISE EXCEPTION 'dealer_inventory_canonical_link_patch_not_unique';
 END IF;
 EXECUTE replace(definition,needle,
   'OR (tt.table_id IS NOT NULL AND tt.table_id IS DISTINCT FROM g.id) OR tt.tournament_id IS DISTINCT FROM s.tournament_id');
END;
$patch$;
COMMIT;
