import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migration = readFileSync(new URL(
  "../../supabase/migrations/20270128000009_tracker_history_reparent_invalidation_v1.sql",
  import.meta.url,
), "utf8");
const container = process.env.TRACKER_HISTORY_PG17_DOCKER_CONTAINER
  ?? "supabase_db_vinpoker-test-canonical-v1";
const database = `tracker_reparent_${randomUUID().replaceAll("-", "")}`;

function dockerPsql(db, sql) {
  const result = spawnSync("docker", [
    "exec", "-i", "-e", "PGPASSWORD=postgres", container,
    "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only",
    "--no-align", "--quiet", "--username", "postgres", "--dbname", db,
  ], { input: sql, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql exited ${result.status}`);
  }
  return result.stdout.trim();
}

function dockerPsqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", [
      "exec", "-i", "-e", "PGPASSWORD=postgres", container,
      "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only",
      "--no-align", "--quiet", "--username", "postgres", "--dbname", db,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function openBarrierController(db, lockKey) {
  const child = spawn("docker", [
    "exec", "-i", "-e", "PGPASSWORD=postgres", container,
    "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only",
    "--no-align", "--quiet", "--username", "postgres", "--dbname", db,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let readyResolve;
  let readyReject;
  let isReady = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve) => {
    child.once("close", (code) => {
      if (!isReady) readyReject(new Error(stderr || stdout || `barrier controller exited ${code}`));
      resolve({ code, stdout, stderr });
    });
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("barrier_ready")) {
      isReady = true;
      readyResolve();
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.once("error", readyReject);
  child.stdin.write(`BEGIN;\nSELECT pg_advisory_xact_lock(${lockKey});\n\\echo barrier_ready\n`);
  return {
    ready,
    release() { child.stdin.end("COMMIT;\n\\q\n"); },
    done,
  };
}

async function waitForScalar(db, sql, expected, label) {
  const deadline = Date.now() + 5_000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = dockerPsql(db, sql);
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(actual, expected, label);
}

const bootstrap = String.raw`
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $roles$;

CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  hand_number integer NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  is_voided boolean NOT NULL DEFAULT false,
  source_revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  note text
);
CREATE TABLE public.hand_actions (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  note text
);
CREATE TABLE public.tournament_settlement_outcomes (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  source_revision bigint NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tracker_historical_display_queue (
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  source_revision bigint NOT NULL,
  status text NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, source_revision)
);

CREATE OR REPLACE FUNCTION public.tracker_mark_prior_settlements_stale(p_changed_hand_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $fn$
  UPDATE public.tournament_settlement_outcomes
  SET status = 'stale', updated_at = now()
  WHERE hand_id = p_changed_hand_id AND status = 'verified';
$fn$;

CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display(p_hand_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_revision bigint;
BEGIN
  SELECT source_revision INTO v_revision FROM public.tournament_hands WHERE id = p_hand_id;
  UPDATE public.tracker_historical_display_queue
  SET status = 'cancelled', lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE hand_id = p_hand_id AND source_revision <> v_revision
    AND status IN ('pending', 'processing');
  INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision, status)
  VALUES (p_hand_id, v_revision, 'pending')
  ON CONFLICT (hand_id, source_revision) DO UPDATE
    SET status = 'pending', lease_token = NULL, lease_until = NULL, updated_at = now();
END $fn$;

CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.tracker_enqueue_historical_display(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END $fn$;
CREATE TRIGGER trg_tracker_enqueue_historical_display
AFTER UPDATE ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION public.tracker_enqueue_historical_display_trigger();

-- Previous migration state: 00009 must replace this function and move both
-- outcome-relevant child triggers from AFTER to BEFORE.
CREATE OR REPLACE FUNCTION public.tracker_bump_hand_source_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  UPDATE public.tournament_hands SET source_revision = source_revision + 1, updated_at = now()
  WHERE id = COALESCE(NEW.hand_id, OLD.hand_id);
  PERFORM public.tracker_mark_prior_settlements_stale(COALESCE(NEW.hand_id, OLD.hand_id));
  RETURN COALESCE(NEW, OLD);
END $fn$;
CREATE TRIGGER trg_tracker_hand_player_source_revision
AFTER INSERT OR UPDATE OR DELETE ON public.hand_players
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();
CREATE TRIGGER trg_tracker_hand_action_source_revision
AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();
`;

const barrierKey = 424242;
const barrierSql = String.raw`
CREATE OR REPLACE FUNCTION public.tracker_test_reparent_barrier()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(${barrierKey});
  RETURN NEW;
END $fn$;
-- PostgreSQL fires same-kind triggers in name order. The aaa_ prefix makes the
-- disposable barrier run before the production revision trigger.
CREATE TRIGGER aaa_tracker_test_reparent_barrier
BEFORE UPDATE OF hand_id ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION public.tracker_test_reparent_barrier();
`;

const ids = {
  playerA: "10000000-0000-4000-8000-000000000001",
  playerB: "10000000-0000-4000-8000-000000000002",
  actionA: "20000000-0000-4000-8000-000000000001",
  actionB: "20000000-0000-4000-8000-000000000002",
  same: "30000000-0000-4000-8000-000000000001",
  deleted: "40000000-0000-4000-8000-000000000001",
  inserted: "50000000-0000-4000-8000-000000000001",
  concurrentA: "60000000-0000-4000-8000-000000000001",
  concurrentB: "60000000-0000-4000-8000-000000000002",
};

const q = (value) => `'${value}'::uuid`;
const seedHand = (id, handNumber = 1) => `INSERT INTO public.tournament_hands(id,tournament_id,hand_number) VALUES (${q(id)},'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${handNumber});`;
const seedProof = (id, outcomeId, lease = false) => `
  INSERT INTO public.tournament_settlement_outcomes(id,hand_id,source_revision,status)
  SELECT ${q(outcomeId)},id,source_revision,'verified' FROM public.tournament_hands WHERE id=${q(id)};
  INSERT INTO public.tracker_historical_display_queue(hand_id,source_revision,status,lease_token,lease_until)
  SELECT id,source_revision,${lease ? "'processing'" : "'completed'"},${lease ? "'99999999-9999-4999-8999-999999999999'::uuid" : "NULL"},${lease ? "now()+interval '10 minutes'" : "NULL"}
  FROM public.tournament_hands WHERE id=${q(id)}
  ON CONFLICT (hand_id,source_revision) DO UPDATE
  SET status=EXCLUDED.status, lease_token=EXCLUDED.lease_token, lease_until=EXCLUDED.lease_until;
`;

test("PostgreSQL 17 reparent invalidates both hands without stale worker publication", async (t) => {
  if (process.env.TRACKER_HISTORY_PG17_ALLOW_DISPOSABLE !== "1") {
    throw new Error("TRACKER_HISTORY_PG17_ALLOW_DISPOSABLE=1 is required");
  }
  dockerPsql("postgres", `CREATE DATABASE ${database};`);
  t.after(() => dockerPsql("postgres", `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`));
  dockerPsql(database, bootstrap);
  dockerPsql(database, migration);

  dockerPsql(database, `
    ${seedHand(ids.playerA, 1)} ${seedHand(ids.playerB, 2)}
    INSERT INTO public.hand_players(id,hand_id,note) VALUES ('11000000-0000-4000-8000-000000000001',${q(ids.playerA)},'seed');
    ${seedProof(ids.playerA, "11100000-0000-4000-8000-000000000001", true)}
    ${seedProof(ids.playerB, "11100000-0000-4000-8000-000000000002")}
    UPDATE public.hand_players SET hand_id=${q(ids.playerB)} WHERE id='11000000-0000-4000-8000-000000000001';
  `);
  assert.equal(dockerPsql(database, `
    SELECT string_agg(id::text || ':' || source_revision::text, ',' ORDER BY id)
    FROM public.tournament_hands WHERE id IN (${q(ids.playerA)},${q(ids.playerB)});
  `), `${ids.playerA}:3,${ids.playerB}:2`);
  assert.equal(dockerPsql(database, `
    SELECT count(*) FROM public.tournament_settlement_outcomes
    WHERE hand_id IN (${q(ids.playerA)},${q(ids.playerB)}) AND status='verified';
  `), "0", "both public proofs must disappear after player reparent");
  assert.equal(dockerPsql(database, `
    SELECT count(*) FROM public.tracker_historical_display_queue q
    JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
    WHERE h.id IN (${q(ids.playerA)},${q(ids.playerB)}) AND q.status='pending';
  `), "2", "both current revisions must be queued");
  assert.equal(dockerPsql(database, `
    SELECT count(*) FROM public.tracker_historical_display_queue
    WHERE hand_id=${q(ids.playerA)} AND source_revision=2 AND status='processing';
  `), "0", "held lease must be cancelled during reparent");
  assert.equal(dockerPsql(database, `
    WITH stale_worker_commit AS (
      UPDATE public.tracker_historical_display_queue q SET status='completed'
      FROM public.tournament_hands h
      WHERE q.hand_id=${q(ids.playerA)} AND q.source_revision=2
        AND q.status='processing' AND q.lease_token='99999999-9999-4999-8999-999999999999'
        AND h.id=q.hand_id AND h.source_revision=q.source_revision
      RETURNING 1
    ) SELECT count(*) FROM stale_worker_commit;
  `), "0", "stale worker lease cannot commit");

  dockerPsql(database, `
    ${seedHand(ids.actionA, 3)} ${seedHand(ids.actionB, 4)}
    INSERT INTO public.hand_actions(id,hand_id,note) VALUES ('22000000-0000-4000-8000-000000000001',${q(ids.actionA)},'seed');
    ${seedProof(ids.actionA, "22200000-0000-4000-8000-000000000001")}
    ${seedProof(ids.actionB, "22200000-0000-4000-8000-000000000002")}
    UPDATE public.hand_actions SET hand_id=${q(ids.actionB)} WHERE id='22000000-0000-4000-8000-000000000001';
  `);
  assert.equal(dockerPsql(database, `
    SELECT count(*) FROM public.tournament_settlement_outcomes
    WHERE hand_id IN (${q(ids.actionA)},${q(ids.actionB)}) AND status='verified';
  `), "0", "both public proofs must disappear after action reparent");
  assert.equal(dockerPsql(database, `
    SELECT count(*) FROM public.tracker_historical_display_queue q
    JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
    WHERE h.id IN (${q(ids.actionA)},${q(ids.actionB)}) AND q.status='pending';
  `), "2");

  dockerPsql(database, `
    ${seedHand(ids.same, 5)}
    INSERT INTO public.hand_actions(id,hand_id,note) VALUES ('33000000-0000-4000-8000-000000000001',${q(ids.same)},'before');
    UPDATE public.hand_actions SET note='after' WHERE id='33000000-0000-4000-8000-000000000001';
  `);
  assert.equal(dockerPsql(database, `SELECT source_revision FROM public.tournament_hands WHERE id=${q(ids.same)};`), "3", "same-hand update bumps once");

  dockerPsql(database, `
    ${seedHand(ids.deleted, 6)}
    INSERT INTO public.hand_players(id,hand_id,note) VALUES ('44000000-0000-4000-8000-000000000001',${q(ids.deleted)},'delete');
    DELETE FROM public.hand_players WHERE id='44000000-0000-4000-8000-000000000001';
    ${seedHand(ids.inserted, 7)}
    INSERT INTO public.hand_players(id,hand_id,note) VALUES ('55000000-0000-4000-8000-000000000001',${q(ids.inserted)},'insert');
  `);
  assert.equal(dockerPsql(database, `SELECT source_revision FROM public.tournament_hands WHERE id=${q(ids.deleted)};`), "3", "delete bumps its old hand once");
  assert.equal(dockerPsql(database, `SELECT source_revision FROM public.tournament_hands WHERE id=${q(ids.inserted)};`), "2", "insert bumps its new hand once");

  dockerPsql(database, `
    ${seedHand(ids.concurrentA, 8)} ${seedHand(ids.concurrentB, 9)}
    INSERT INTO public.hand_actions(id,hand_id,note) VALUES
      ('66000000-0000-4000-8000-000000000001',${q(ids.concurrentA)},'a-to-b'),
      ('66000000-0000-4000-8000-000000000002',${q(ids.concurrentB)},'b-to-a');
    ${barrierSql}
  `);
  assert.equal(dockerPsql(database, `
    SELECT string_agg(tgname || ':' || CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END, ',' ORDER BY tgname)
    FROM pg_catalog.pg_trigger
    WHERE tgrelid IN ('public.hand_players'::regclass, 'public.hand_actions'::regclass)
      AND tgname IN ('trg_tracker_hand_player_source_revision','trg_tracker_hand_action_source_revision');
  `), "trg_tracker_hand_action_source_revision:BEFORE,trg_tracker_hand_player_source_revision:BEFORE");

  const controller = openBarrierController(database, barrierKey);
  await controller.ready;
  const first = dockerPsqlAsync(database, `BEGIN; UPDATE public.hand_actions SET hand_id=${q(ids.concurrentB)} WHERE id='66000000-0000-4000-8000-000000000001'; COMMIT;`);
  const second = dockerPsqlAsync(database, `BEGIN; UPDATE public.hand_actions SET hand_id=${q(ids.concurrentA)} WHERE id='66000000-0000-4000-8000-000000000002'; COMMIT;`);
  await waitForScalar(database, `
    SELECT count(*) FROM pg_catalog.pg_locks
    WHERE locktype='advisory' AND classid=0 AND objid=${barrierKey} AND NOT granted;
  `, "2", "both opposite child UPDATEs must be blocked inside the test barrier");
  controller.release();
  const results = await Promise.all([first, second, controller.done]);
  assert.deepEqual(results.map(({ code }) => code), [0, 0, 0], results.map(({ stderr }) => stderr).join("\n"));
  assert.ok(results.every(({ stderr }) => !/deadlock detected/i.test(stderr)), "opposite reparent overlap must not deadlock");
  assert.equal(dockerPsql(database, `
    SELECT string_agg(id::text || ':' || source_revision::text, ',' ORDER BY id)
    FROM public.tournament_hands WHERE id IN (${q(ids.concurrentA)},${q(ids.concurrentB)});
  `), `${ids.concurrentA}:4,${ids.concurrentB}:4`, "each overlapped reparent must bump both hands exactly once");
});

assert.equal(basename(root), "VinPoker");
