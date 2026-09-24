const required = ["API_BASE", "ANON_KEY", "PLAYER_EMAIL", "PLAYER_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`missing ${name}`);
}

const api = process.env.API_BASE.replace(/\/$/, "");
const anon = process.env.ANON_KEY;
const tournamentId = "a3000000-0000-4000-8000-000000000001";

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${api}${path}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

const login = await jsonRequest("/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.PLAYER_EMAIL, password: process.env.PLAYER_PASSWORD }),
});
if (!login.response.ok || !login.body?.access_token) {
  throw new Error(`local Auth login failed (${login.response.status})`);
}
const accessToken = login.body.access_token;
const headers = {
  apikey: anon,
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
};

const unauthenticated = await jsonRequest("/functions/v1/tournament-register", {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ tournament_id: tournamentId }),
});
if (unauthenticated.response.status !== 401) {
  throw new Error(`missing-auth request was not denied (${unauthenticated.response.status})`);
}

const [first, second] = await Promise.all([
  jsonRequest("/functions/v1/tournament-register", {
    method: "POST", headers, body: JSON.stringify({ tournament_id: tournamentId }),
  }),
  jsonRequest("/functions/v1/tournament-register", {
    method: "POST", headers, body: JSON.stringify({ tournament_id: tournamentId }),
  }),
]);
for (const call of [first, second]) {
  if (!call.response.ok || call.body?.success !== true) {
    throw new Error(`registration failed (${call.response.status})`);
  }
  if (Number(call.body.total_pay) !== 6600000) throw new Error("server price snapshot is not 6.6m");
}
if (first.body.registration_id !== second.body.registration_id) {
  throw new Error("parallel registration created different registrations");
}
if (![first.body.already_registered, second.body.already_registered].includes(true)) {
  throw new Error("parallel retry was not reported as already registered");
}

const forbiddenRpc = await jsonRequest("/rest/v1/rpc/cashier_create_app_registration_v1", {
  method: "POST", headers,
  body: JSON.stringify({ p_tournament_id: tournamentId, p_player_id: login.body.user.id }),
});
if (![401, 403, 404].includes(forbiddenRpc.response.status)) {
  throw new Error(`authenticated player reached service-only RPC (${forbiddenRpc.response.status})`);
}

process.stdout.write(JSON.stringify({
  registration_id: first.body.registration_id,
  reference_code: first.body.reference_code,
  player_id: login.body.user.id,
}));
