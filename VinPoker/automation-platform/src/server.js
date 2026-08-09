import http from "node:http";
import { URL } from "node:url";
import { loadConfig, assertRuntimeSecrets } from "./config.js";
import { AutomationGateway } from "./gateway.js";
import { renderDashboard } from "./dashboard.js";
import { createHmacVerifier } from "./security/hmac.js";
import { SqliteAutomationStore } from "./store/sqlite-store.js";

const MAX_BODY_BYTES = 32 * 1024;
const config = loadConfig();
assertRuntimeSecrets(config);
const store = new SqliteAutomationStore({ dbPath: config.dbPath });
const gateway = new AutomationGateway({ store, config });

if (config.autoSeed && store.count("events") === 0) {
  gateway.seedFixtures({ reset: false });
}

const verifyHmac = createHmacVerifier({
  config,
  nonceStore: store,
  rateLimiter: store,
});

const routes = new Map([
  ["POST /automation-gateway/claim", (body) => gateway.claim(body)],
  [
    "POST /automation-gateway/preflight",
    (body, auth) => gateway.preflight(withWorkerContext(body, auth)),
  ],
  [
    "POST /automation-gateway/artifacts/owner-daily-digest",
    (body, auth) => gateway.buildDigestArtifact(withWorkerContext(body, auth)),
  ],
  [
    "POST /automation-gateway/notifications/enqueue",
    (body, auth) => gateway.enqueue(withWorkerContext(body, auth)),
  ],
  [
    "POST /automation-gateway/complete",
    (body, auth) => gateway.complete(withWorkerContext(body, auth)),
  ],
  [
    "POST /automation-gateway/fail",
    (body, auth) => gateway.fail(withWorkerContext(body, auth)),
  ],
  [
    "POST /automation-gateway/heartbeat",
    (body, auth) => gateway.heartbeat(withWorkerContext(body, auth)),
  ],
]);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        environment: config.environment,
        external_send_enabled: false,
        p0_owner: "SERVER_NATIVE",
      });
    }
    if (request.method === "GET" && url.pathname === "/automation-gateway/status") {
      return sendJson(response, 200, gateway.status());
    }
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/automation-gateway/trace/")
    ) {
      const traceId = decodeURIComponent(url.pathname.slice("/automation-gateway/trace/".length));
      return sendJson(response, 200, gateway.trace(traceId));
    }
    if (request.method === "GET" && url.pathname === "/dashboard") {
      const traceId = url.searchParams.get("trace") ?? "";
      const trace = traceId ? gateway.trace(traceId) : null;
      return sendHtml(response, 200, renderDashboard({
        status: gateway.status(),
        traceId,
        trace,
      }));
    }
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(302, { location: "/dashboard" });
      return response.end();
    }

    const handler = routes.get(`${request.method} ${url.pathname}`);
    if (!handler) return sendJson(response, 404, safeError("NOT_FOUND", "Route not found"));

    const rawBody = await readBody(request);
    const auth = verifyHmac({
      method: request.method,
      path: url.pathname,
      rawBody,
      headers: request.headers,
    });
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (
      body.workflow_key &&
      body.workflow_key !== auth.workflowKey
    ) {
      throw codedError("WORKFLOW_HEADER_MISMATCH", "Workflow header does not match body");
    }
    if (body.worker_id && body.worker_id !== auth.workerId) {
      throw codedError("WORKER_HEADER_MISMATCH", "Worker header does not match body");
    }
    const result = handler(body, auth);
    return sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    const code = error.code ?? (error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR");
    const status = error.statusCode ?? statusFor(code);
    return sendJson(response, status, safeError(code, safeMessage(error, code)));
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `VBacker Automation Gateway ${config.environment} listening on http://${config.host}:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(codedError("PAYLOAD_TOO_LARGE", "Request exceeds 32 KiB", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function safeError(code, message) {
  return { ok: false, error: { code, message } };
}

function safeMessage(error, code) {
  if (code === "INTERNAL_ERROR") return "Unexpected local gateway error";
  return String(error.message ?? code).slice(0, 300);
}

function statusFor(code) {
  if (["NOT_FOUND"].includes(code)) return 404;
  if (code.startsWith("HMAC_") || code.includes("ENVIRONMENT")) return 401;
  if (
    code.includes("KILL_SWITCH") ||
    code.includes("DENIED") ||
    code.includes("NOT_ALLOWLISTED") ||
    code === "P0_NATIVE_ONLY"
  ) return 403;
  if (code === "RATE_LIMITED") return 429;
  if (code === "CLAIM_LOST") return 409;
  if (code === "PAYLOAD_TOO_LARGE") return 413;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}

function withWorkerContext(body, auth) {
  return {
    ...body,
    worker_id: auth.workerId,
    workflow_key: auth.workflowKey,
  };
}

function codedError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
