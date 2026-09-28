import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "TV_UAT_EMAIL", "TV_UAT_PASSWORD", "TV_DISPLAY_TOKEN", "TV_TOURNAMENT_ID", "RELEASE_SHA", "DEPLOYED_SHA", "OUTPUT_PATH"];
for (const name of required) if (!process.env[name]) throw new Error(`Missing protected UAT input ${name}`);
if (!/^[0-9a-f]{40}$/.test(process.env.RELEASE_SHA) || process.env.DEPLOYED_SHA !== process.env.RELEASE_SHA) throw new Error("Deployment provenance mismatch");
const headers = { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
const auth = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers, body: JSON.stringify({ email: process.env.TV_UAT_EMAIL, password: process.env.TV_UAT_PASSWORD }) });
if (!auth.ok) throw new Error(`Protected UAT authentication failed ${auth.status}`);
const session = await auth.json();
if (!session.access_token) throw new Error("Protected UAT authentication returned no session");
async function rpc(name, body, authorization = null) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...headers, ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${name} failed ${response.status}`);
  return response.json();
}
const publicState = await rpc("get_tv_display_state_v3", { p_display_token: process.env.TV_DISPLAY_TOKEN });
const branding = await rpc("get_tv_tournament_branding_v1", { p_tournament_id: process.env.TV_TOURNAMENT_ID }, session.access_token);
if (!publicState || !branding) throw new Error("TV Stage A returned empty state");
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
writeFileSync(process.env.OUTPUT_PATH, `${JSON.stringify({ schemaVersion: 1, kind: "vinpoker-tv-stage-a-production-uat", releaseSha: process.env.RELEASE_SHA, deployedSha: process.env.DEPLOYED_SHA, publicRead: "PASS", authenticatedRead: "PASS", publicResultFingerprint: fingerprint(publicState), authenticatedResultFingerprint: fingerprint(branding), containsPrivateIds: false }, null, 2)}\n`);

