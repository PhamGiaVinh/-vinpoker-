import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const archived = readFileSync(resolve(root,
  "supabase/migration-archive/historical-never-replay/20261019000000_chip_ops_ledger_bank.sql"), "utf8");
const migration = readFileSync(resolve(root,
  "supabase/migrations/20270128000011_chip_ops_bank_adjust_integrity_v1.sql"), "utf8");
const start = archived.indexOf("CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(");
const end = archived.indexOf("$$;", start) + 3;
assert.ok(start >= 0 && end > start);
// Match the reviewed live prosrc digest, including its CRLF body line endings.
const priorFunction = archived.slice(start, end).replace(/\r\n?|\n/g, "\r\n");

function psql(sql) {
  return execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGDATABASE: process.env.PGDATABASE || "postgres" },
  }).trim();
}

test("bank adjustment enforces payload-safe retries, club identity and CAS in PostgreSQL 17", () => {
  psql(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION public.is_club_owner(uuid,uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT $1 IS NOT NULL AND $2 IS NOT NULL $$;
    CREATE FUNCTION public.is_club_chip_master(uuid,uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE public.clubs(id uuid PRIMARY KEY);
    CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid NOT NULL,
      deleted_at timestamptz);
    CREATE TABLE public.chip_set_denomination(id uuid PRIMARY KEY, club_id uuid NOT NULL);
    CREATE TABLE public.chip_bank(club_id uuid NOT NULL, denomination_id uuid NOT NULL,
      on_hand_count bigint NOT NULL CHECK (on_hand_count >= 0), version integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
      PRIMARY KEY (club_id, denomination_id));
    CREATE TABLE public.chip_bank_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id uuid NOT NULL, denomination_id uuid NOT NULL, tournament_id uuid,
      direction text NOT NULL, count bigint NOT NULL, balance_after bigint NOT NULL,
      reason text, idempotency_key text, actor uuid, details jsonb NOT NULL DEFAULT '{}');
    CREATE UNIQUE INDEX uq_cbl_idempotency ON public.chip_bank_ledger(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    INSERT INTO public.clubs VALUES
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002');
    INSERT INTO public.chip_set_denomination VALUES
      ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001');
    INSERT INTO public.tournaments VALUES
      ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',NULL),
      ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002',NULL);
  `);
  psql(priorFunction);
  // This executes the exact forward migration, including its live-body precondition.
  psql(migration);

  const result = psql(`
    SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','thu',10,
      '00000000-0000-0000-0000-000000000021',0,'key-1');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','thu',10,
      '00000000-0000-0000-0000-000000000021',0,'key-1');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','thu',11,
      '00000000-0000-0000-0000-000000000021',0,'key-1');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','thu',1,
      '00000000-0000-0000-0000-000000000022',1,'key-cross-club');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','xuat',11,
      '00000000-0000-0000-0000-000000000021',1,'key-negative');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','xuat',4,
      '00000000-0000-0000-0000-000000000021',0,'key-stale');
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','xuat',4,
      '00000000-0000-0000-0000-000000000021',1,'key-2');
    SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
    SELECT public.chip_ops_bank_adjust('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000011','thu',10,
      '00000000-0000-0000-0000-000000000021',0,'key-1');
    SELECT on_hand_count || ':' || version FROM public.chip_bank;
    SELECT count(*) FROM public.chip_bank_ledger;
    SELECT has_function_privilege('anon',
      'public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)', 'EXECUTE');
  `).split(/\r?\n/).filter((line) => line.startsWith("{") || /^(6:2|2|f)$/.test(line));
  assert.equal(JSON.parse(result[0]).balance_after, 10);
  assert.equal(JSON.parse(result[1]).idempotent, true);
  assert.equal(JSON.parse(result[2]).error, "IDEMPOTENCY_CONFLICT");
  assert.equal(JSON.parse(result[3]).error, "TOURNAMENT_NOT_IN_CLUB");
  assert.equal(JSON.parse(result[4]).error, "BANK_NEGATIVE");
  assert.equal(JSON.parse(result[5]).error, "race_lost");
  assert.equal(JSON.parse(result[6]).balance_after, 6);
  assert.equal(JSON.parse(result[7]).error, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(result.slice(8), ["6:2", "2", "f"]);
});
