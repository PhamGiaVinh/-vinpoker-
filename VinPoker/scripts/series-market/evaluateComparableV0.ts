import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import { buildJejuComparableCorpus, evaluateComparableV0 } from "../../src/lib/series-market/comparableEvent";
import { createVerifiedJejuReadModel } from "../../src/lib/series-market/verifiedMarketReadModel";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const releaseRoot = resolve(appRoot, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(resolve(releaseRoot, name), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const model = await createVerifiedJejuReadModel({
    canonicalImport: artifact("canonical/jeju_import_v1.json"),
    release: artifact("release.json"),
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
  const evaluation = evaluateComparableV0(buildJejuComparableCorpus(model));
  process.stdout.write(`${JSON.stringify(JSON.parse(canonicalize(evaluation)), null, 2)}\n`);
}

await main();
