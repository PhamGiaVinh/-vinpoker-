import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
    CREATE SCHEMA floor_private;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_club_owner(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${uid}'::uuid AND $2='${club}'::uuid $$;
    CREATE FUNCTION public.is_club_chip_master(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.chip_ops_coupling_on(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid,current_level integer,deleted_at timestamptz);
    CREATE TABLE public.tournament_chip_set(tournament_id uuid,chip_set_id uuid);
    CREATE TABLE public.chip_set_denomination(id uuid PRIMARY KEY,chip_set_id uuid,value bigint,club_id uuid,color text);
    CREATE TABLE public.chip_bank(club_id uuid,denomination_id uuid,on_hand_count bigint);
    CREATE TABLE public.chip_bank_ledger(ref_type text,ref_id uuid,reason text);
    CREATE TABLE public.stack_template(id uuid PRIMARY KEY,tournament_id uuid,club_id uuid);
    CREATE TABLE public.stack_template_line(stack_template_id uuid,denomination_id uuid,count integer);
    CREATE TABLE public.stack_template_issuance(stack_template_id uuid PRIMARY KEY,issued_count integer,club_id uuid,updated_by uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.color_up_operation(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,club_id uuid,denom_removed uuid,denom_target uuid,
      removed_count bigint,target_added bigint,value_removed bigint,value_added bigint,rounding_delta bigint,level_number integer,idempotency_key text UNIQUE,
      confirmed_by uuid,status text DEFAULT 'confirmed',confirmed_at timestamptz DEFAULT now(),reversed_by uuid,reversed_at timestamptz);
    CREATE TABLE public.color_up_line(operation_id uuid,club_id uuid,denomination_id uuid,role text,count_before bigint,count_after bigint);
    CREATE TABLE public.chip_inventory_ledger(tournament_id uuid,club_id uuid,denomination_id uuid,delta_count bigint,reason text,ref_type text,ref_id uuid,details jsonb);
    CREATE FUNCTION public.chip_ops_current_denom_counts(uuid) RETURNS TABLE(denomination_id uuid,value bigint,color text,issued_count bigint,current_count bigint) LANGUAGE sql AS $$
      SELECT d.id,d.value,d.color,(CASE WHEN d.id='${low}'::uuid THEN 10 ELSE 0 END)::bigint,
      (CASE WHEN d.id='${low}'::uuid THEN 10 ELSE 0 END + COALESCE((SELECT sum(l.delta_count) FROM public.chip_inventory_ledger l WHERE l.tournament_id=$1 AND l.denomination_id=d.id),0))::bigint FROM public.chip_set_denomination d $$;
    INSERT INTO public.tournaments VALUES('${tour}','${club}',1,null);
    INSERT INTO public.tournament_chip_set VALUES('${tour}','${club}');
    INSERT INTO public.chip_set_denomination VALUES('${low}','${club}',100,'${club}',null),('${high}','${club}',1000,'${club}',null);
    INSERT INTO public.stack_template VALUES('${club}','${tour}','${club}');
    INSERT INTO public.stack_template_line VALUES('${club}','${low}',10);
    INSERT INTO public.stack_template_issuance VALUES('${club}',1,'${club}','${uid}',now());
    ${functionSql("chip_ops_color_up")}
    SET request.jwt.claim.sub='${uid}';
  `);
  if (process.env.VINPOKER_REPRO_LEGACY !== "1") {
    sql(readFileSync("supabase/migrations/20270128000016_chip_color_up_serialized_integrity_v1.sql","utf8"));
  }
  const result = sql(`SET request.jwt.claim.sub='${uid}';
    SELECT public.chip_ops_color_up('${tour}','${low}','${high}',1,1,'same-key');
    SELECT public.chip_ops_color_up('${tour}','${low}','${high}',2,1,'same-key');`).split(/\r?\n/).map(JSON.parse);
  assert.equal(result[0].status,"ok");
  assert.equal(result[1].error,"IDEMPOTENCY_CONFLICT");
  const replay=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_color_up('${tour}','${low}','${high}',1,1,'same-key');`));
  assert.deepEqual(replay,result[0]);
  assert.equal(sql("SELECT count(*) FROM public.chip_inventory_ledger"),"2");
  const issuance=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_set_issuance('${club}',0);`));
  assert.equal(issuance.error,"INVENTORY_NEGATIVE");
  assert.throws(() => sql(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000099'; SELECT * FROM public.chip_ops_current_denom_counts('${tour}');`),/chip_inventory_access_denied/);
});

test("dependent color-ups must undo in reverse order without negative counts", () => {
  const third="00000000-0000-0000-0000-000000000006";
  const op1=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_color_up('${tour}','${low}','${high}',1,1,'same-key');`)).color_up_operation_id;
  sql(`INSERT INTO public.chip_set_denomination VALUES('${third}','${club}',10000,'${club}',null);`);
  const op2=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_color_up('${tour}','${high}','${third}',0,2,'second-key');`));
  assert.equal(op2.status,"ok");
  const blocked=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_reverse_color_up('${op1}','undo-first');`));
  assert.equal(blocked.error,"UNDO_DEPENDENCY");
  const reverse2=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_reverse_color_up('${op2.color_up_operation_id}','undo-second');`));
  assert.equal(reverse2.status,"ok");
  const conflict=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_reverse_color_up('${op1}','undo-second');`));
  assert.equal(conflict.error,"IDEMPOTENCY_CONFLICT");
  const reverse1=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_reverse_color_up('${op1}','undo-first');`));
  assert.equal(reverse1.status,"ok");
  assert.equal(sql(`SET request.jwt.claim.sub='${uid}'; SELECT current_count FROM public.chip_ops_current_denom_counts('${tour}') WHERE denomination_id='${low}'`),"10");
  assert.equal(sql(`SET request.jwt.claim.sub='${uid}'; SELECT count(*) FROM public.chip_ops_current_denom_counts('${tour}') WHERE current_count<0`),"0");
});

function concurrentSql(query) {
  return new Promise((resolve,reject) => {
    const process=spawn("psql",["-X","-qAt","-v","ON_ERROR_STOP=1"]);
    let output=""; let error="";
    process.stdout.on("data",chunk=>output+=chunk); process.stderr.on("data",chunk=>error+=chunk);
    process.on("error",reject); process.on("close",code=>code===0?resolve(output.trim()):reject(new Error(error)));
    process.stdin.end(query);
  });
}
test("issuance and color-up overlap on the same tournament lock and consume one current snapshot", async () => {
  const writer=concurrentSql(`BEGIN; SET request.jwt.claim.sub='${uid}';
    SELECT public.chip_ops_set_issuance('${club}',2); SELECT pg_sleep(1.5) /* colorup_issuance_barrier */; COMMIT;`);
  let overlapping=false;
  for(let attempt=0;attempt<60;attempt++) {
    if(sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%colorup_issuance_barrier%' AND wait_event='PgSleep'")==="1") { overlapping=true; break; }
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(overlapping,true,"issuance must be holding its uncommitted tournament lock");
  const color=concurrentSql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_color_up('${tour}','${low}','${high}',2,3,'concurrent-key');`);
  await writer;
  const result=JSON.parse(await color);
  assert.equal(result.status,"ok"); assert.equal(result.removed_count,20);
  assert.equal(sql(`SET request.jwt.claim.sub='${uid}'; SELECT current_count FROM public.chip_ops_current_denom_counts('${tour}') WHERE denomination_id='${high}'`),"2");
  // Simulate later consumption through the actual ledger seam, not a mock response.
  sql(`INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason) VALUES('${tour}','${club}','${high}',-1,'TEST consumption');`);
  const undo=JSON.parse(sql(`SET request.jwt.claim.sub='${uid}'; SELECT public.chip_ops_reverse_color_up('${result.color_up_operation_id}','negative-undo');`));
  assert.equal(undo.error,"INVENTORY_NEGATIVE");
  assert.equal(sql(`SELECT status FROM public.color_up_operation WHERE id='${result.color_up_operation_id}'`),"confirmed");
});
