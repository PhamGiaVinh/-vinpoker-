import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const required = ["SUPABASE_DB_PASSWORD", "TV_TOURNAMENT_ID", "BROWSER_UAT_ACK", "RELEASE_SHA", "DEPLOYED_SHA", "OUTPUT_PATH"];
for (const name of required) if (!process.env[name]) throw new Error(`Missing protected UAT input ${name}`);
const release = process.env.RELEASE_SHA;
if (!/^[0-9a-f]{40}$/.test(release) || process.env.DEPLOYED_SHA !== release) throw new Error("Deployment provenance mismatch");
if (!/^[0-9a-f-]{36}$/i.test(process.env.TV_TOURNAMENT_ID)) throw new Error("Invalid tournament ID");
if (process.env.BROWSER_UAT_ACK !== `BROWSER_TV_READ_PASS_${release}`) throw new Error("Missing exact browser UAT acknowledgment");

// No paired TV displays exist in this project. Probe the actual tournament TV
// branding path and the anonymous display RPC ACL. The browser acknowledgment
// covers real rendering; this role probe does not impersonate a browser login.
const sql = String.raw`BEGIN;
SELECT EXISTS (SELECT 1 FROM public.tournaments WHERE id = :'tournament_id'::uuid AND deleted_at IS NULL) AS sample_ok \gset
SET ROLE authenticated;
SELECT (public.get_tv_tournament_branding_v1(:'tournament_id'::uuid) IS NOT NULL) AS branding_ok \gset
RESET ROLE;
SET ROLE anon;
SELECT (public.get_tv_display_state_v3(repeat('x', 32))->>'status' = 'invalid') AS display_ok \gset
RESET ROLE;
\echo :sample_ok|:branding_ok|:display_ok
ROLLBACK;
`;
const pgEnv = {
  ...process.env,
  PGHOST: "aws-1-ap-southeast-2.pooler.supabase.com",
  PGPORT: "5432",
  PGUSER: "postgres.orlesggcjamwuknxwcpk",
  PGDATABASE: "postgres",
  PGPASSWORD: process.env.SUPABASE_DB_PASSWORD,
  PGSSLMODE: "require",
  PGAPPNAME: `tv-stage-a-${process.env.GITHUB_RUN_ID ?? "local"}`,
};
const image = "postgres:17.6-bookworm";
const docker = spawnSync("docker", ["run", "--rm", "-i", "--network", "host",
  ...["PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGSSLMODE", "PGAPPNAME"].flatMap((name) => ["--env", name]),
  image, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", `tournament_id=${process.env.TV_TOURNAMENT_ID}`],
{ input: sql, encoding: "utf8", env: pgEnv, timeout: 60_000 });
if (docker.status !== 0 || docker.stdout.trim() !== "t|t|t") throw new Error("TV Stage A database role contract failed; raw output withheld");
writeFileSync(process.env.OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 2,
  kind: "vinpoker-tv-stage-a-production-uat",
  releaseSha: release,
  deployedSha: release,
  authenticatedBrandingRead: "PASS",
  anonymousDisplayContract: "PASS",
  browserUatAcknowledged: true,
  containsPrivateIds: false,
}, null, 2)}\n`);

