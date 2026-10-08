import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// Isolated PostgreSQL only. Minimal table fixtures; NOT a live-schema parity proof.
function sql(query) {
  return execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" }).trim();
}
const source = readFileSync("supabase/migration-archive/historical-never-replay/20261023000001_chip_ops_bank_couple.sql", "utf8");
function functionSql(name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}
const uid = "00000000-0000-0000-0000-000000000001";
const tour = "00000000-0000-0000-0000-000000000002";
const club = "00000000-0000-0000-0000-000000000003";
const low = "00000000-0000-0000-0000-000000000004";
const high = "00000000-0000-0000-0000-000000000005";

test("Color-up key reuse with changed payload must conflict rather than claim success", () => {
  sql(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_club_owner(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${uid}'::uuid AND $2='${club}'::uuid $$;
    CREATE FUNCTION public.is_club_chip_master(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.chip_ops_coupling_on(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid,current_level integer,deleted_at timestamptz);
    CREATE TABLE public.tournament_chip_set(tournament_id uuid,chip_set_id uuid);
    CREATE TABLE public.chip_set_denomination(id uuid PRIMARY KEY,chip_set_id uuid,value bigint);
    CREATE TABLE public.color_up_operation(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,club_id uuid,denom_removed uuid,denom_target uuid,
      removed_count bigint,target_added bigint,value_removed bigint,value_added bigint,rounding_delta bigint,level_number integer,idempotency_key text UNIQUE,
      confirmed_by uuid,status text DEFAULT 'confirmed',reversed_by uuid,reversed_at timestamptz);
    CREATE TABLE public.color_up_line(operation_id uuid,club_id uuid,denomination_id uuid,role text,count_before bigint,count_after bigint);
    CREATE TABLE public.chip_inventory_ledger(tournament_id uuid,club_id uuid,denomination_id uuid,delta_count bigint,reason text,ref_type text,ref_id uuid,details jsonb);
    CREATE FUNCTION public.chip_ops_current_denom_counts(uuid) RETURNS TABLE(denomination_id uuid,current_count bigint) LANGUAGE sql AS $$
      SELECT d.id, (CASE WHEN d.id='${low}'::uuid THEN 10 ELSE 0 END + COALESCE((SELECT sum(l.delta_count) FROM public.chip_inventory_ledger l WHERE l.tournament_id=$1 AND l.denomination_id=d.id),0))::bigint FROM public.chip_set_denomination d $$;
    INSERT INTO public.tournaments VALUES('${tour}','${club}',1,null);
    INSERT INTO public.tournament_chip_set VALUES('${tour}','${club}');
    INSERT INTO public.chip_set_denomination VALUES('${low}','${club}',100),('${high}','${club}',1000);
    ${functionSql("chip_ops_color_up")}
    SET request.jwt.claim.sub='${uid}';
  `);
  const result = sql(`SET request.jwt.claim.sub='${uid}';
    SELECT public.chip_ops_color_up('${tour}','${low}','${high}',1,1,'same-key');
    SELECT public.chip_ops_color_up('${tour}','${low}','${high}',2,1,'same-key');`).split(/\r?\n/).map(JSON.parse);
  assert.equal(result[0].status,"ok");
  assert.equal(result[1].error,"IDEMPOTENCY_CONFLICT");
});
