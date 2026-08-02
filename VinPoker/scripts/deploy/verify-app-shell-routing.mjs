import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLAYER_MARKER = '<meta name="vinpoker-app-shell" content="player"';
const OPS_MARKER = '<meta name="vinpoker-app-shell" content="ops"';

export function assertShellHtml({ playerHtml, opsHtml }) {
  if (!playerHtml.includes(PLAYER_MARKER) || playerHtml.includes(OPS_MARKER)) {
    throw new Error("index.html is not the Player shell");
  }
  if (!opsHtml.includes(OPS_MARKER) || opsHtml.includes(PLAYER_MARKER)) {
    throw new Error("ops.html is not the Ops shell");
  }
  if (!playerHtml.includes('href="/manifest.webmanifest"')) {
    throw new Error("Player shell manifest is missing");
  }
  if (!opsHtml.includes('href="/ops-manifest.webmanifest"')) {
    throw new Error("Ops shell manifest is missing");
  }
  if (/registerServiceWorker|registerSW|\/sw\.js/u.test(opsHtml)) {
    throw new Error("Ops shell must not register a service worker");
  }
}
export async function verifyLocal(staticDir) {
  const [playerHtml, opsHtml] = await Promise.all([
    readFile(path.join(staticDir, "index.html"), "utf8"),
    readFile(path.join(staticDir, "ops.html"), "utf8"),
  ]);
  assertShellHtml({ playerHtml, opsHtml });
}

async function readText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  return response.text();
}

export async function verifyRemote(baseUrl) {
  const base = new URL(baseUrl);
  const [playerHtml, opsHtml, deepOpsHtml] = await Promise.all([
    readText(new URL("/", base)),
    readText(new URL("/ops", base)),
    readText(new URL("/ops/floor/tournaments/route-contract-probe", base)),
  ]);
  assertShellHtml({ playerHtml, opsHtml });
  assertShellHtml({ playerHtml, opsHtml: deepOpsHtml });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--static-dir") args.staticDir = argv[++index];
    else if (argv[index] === "--base-url") args.baseUrl = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (Boolean(args.staticDir) === Boolean(args.baseUrl)) {
    throw new Error("Provide exactly one of --static-dir or --base-url");
  }
  return args;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.staticDir) await verifyLocal(path.resolve(args.staticDir));
    else await verifyRemote(args.baseUrl);
    process.stdout.write("APP_SHELL_ROUTING_PASS\n");
  } catch (error) {
    process.stderr.write(`APP_SHELL_ROUTING_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
