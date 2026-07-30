import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const VERCEL_BUILD_OUTPUT_ROUTES = Object.freeze([
  {
    src: "/assets/(.*)",
    headers: { "Cache-Control": "no-cache, must-revalidate" },
    continue: true,
  },
  {
    src: "/version.json",
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    continue: true,
  },
  {
    src: "/sw.js",
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    continue: true,
  },
  {
    src: "/service-worker.js",
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    continue: true,
  },
  { handle: "filesystem" },
  { src: "/ops(?:/.*)?", dest: "/ops.html" },
  { src: "/(.*)", dest: "/index.html" },
]);

export function parseArgs(argv) {
  const args = { staticDir: ".vercel/output/static", output: ".vercel/output/config.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--static-dir") args.staticDir = argv[++index];
    else if (value === "--output") args.output = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.staticDir || !args.output) throw new Error("static directory and output are required");
  return args;
}

export async function writeVercelBuildOutputConfig({ staticDir, output }) {
  const resolvedStaticDir = path.resolve(staticDir);
  await Promise.all([
    access(path.join(resolvedStaticDir, "index.html")),
    access(path.join(resolvedStaticDir, "ops.html")),
  ]);
  const resolvedOutput = path.resolve(output);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(
    resolvedOutput,
    `${JSON.stringify({ version: 3, routes: VERCEL_BUILD_OUTPUT_ROUTES })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return resolvedOutput;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const output = await writeVercelBuildOutputConfig(parseArgs(process.argv.slice(2)));
    process.stdout.write(`VERCEL_BUILD_OUTPUT_CONFIG_READY ${path.basename(output)}\n`);
  } catch (error) {
    process.stderr.write(`VERCEL_BUILD_OUTPUT_CONFIG_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
