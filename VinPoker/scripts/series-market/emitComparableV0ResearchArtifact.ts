import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import { emitComparableV0ResearchBundle } from "../../src/lib/series-market/comparableResearchArtifact";
import { createVerifiedJejuReadModel } from "../../src/lib/series-market/verifiedMarketReadModel";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const releaseRoot = resolve(appRoot, "src/lib/series-market/datasets/jeju/v1");

const OPTION_NAMES = new Set([
  "code-sha",
  "dependency-lock-hash",
  "runtime-name",
  "runtime-version",
  "platform",
  "architecture",
  "cpu",
  "gpu",
  "thread-count",
  "executed-at",
  "created-at",
]);

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(resolve(releaseRoot, name), "utf8")) as unknown;
}

function parseOptions(args: readonly string[]): Readonly<Record<string, string>> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const token = args[index];
    const value = args[index + 1];
    if (!token?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("every emitter option must use --name value");
    }
    const name = token.slice(2);
    if (!OPTION_NAMES.has(name)) throw new Error(`unsupported emitter option: ${token}`);
    if (options[name] !== undefined) throw new Error(`duplicate emitter option: ${token}`);
    options[name] = value;
  }
  for (const name of OPTION_NAMES) {
    if (options[name] === undefined) throw new Error(`missing required emitter option: --${name}`);
  }
  return options;
}

function nullable(value: string): string | null {
  return value === "none" ? null : value;
}

function positiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const model = await createVerifiedJejuReadModel({
    canonicalImport: artifact("canonical/jeju_import_v1.json"),
    release: artifact("release.json"),
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
  const bundle = await emitComparableV0ResearchBundle({
    model,
    codeSha: options["code-sha"]!,
    dependencyLockHash: nullable(options["dependency-lock-hash"]!),
    environment: {
      runtimeName: options["runtime-name"]!,
      runtimeVersion: options["runtime-version"]!,
      platform: options.platform!,
      architecture: options.architecture!,
      cpu: nullable(options.cpu!),
      gpu: nullable(options.gpu!),
      threadCount: positiveInteger(options["thread-count"]!, "thread-count"),
      modelCheckpointId: null,
      modelCheckpointHash: null,
    },
    executedAt: options["executed-at"]!,
    createdAt: options["created-at"]!,
  });
  process.stdout.write(`${canonicalize(bundle)}\n`);
}

await main();
