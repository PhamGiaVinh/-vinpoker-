import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hashDecisionPacketV1 } from "../../src/lib/series-intelligence/decisionPacketCanonicalV1";
import { buildDecisionPacketCanonicalVectorDefinitions } from "../../src/lib/series-intelligence/decisionPacketCanonicalVectors";
import {
  renderDecisionPacketCanonicalVectorArtifact,
  type DecisionPacketCanonicalVectorArtifact,
} from "./generate-decision-packet-canonical-vectors";

const artifactPath = resolve(
  import.meta.dirname,
  "../../src/lib/series-intelligence/fixtures/decisionPacketCanonicalV1.vectors.json",
);

async function main(): Promise<void> {
  const expectedText = await renderDecisionPacketCanonicalVectorArtifact();
  const actualText = await readFile(artifactPath, "utf8");
  if (actualText !== expectedText) {
    throw new Error("decision packet canonical vector artifact is stale");
  }

  const artifact = JSON.parse(actualText) as DecisionPacketCanonicalVectorArtifact;
  const definitions = await buildDecisionPacketCanonicalVectorDefinitions();
  if (definitions.length !== artifact.vectors.length) {
    throw new Error("decision packet canonical vector count drifted");
  }
  for (const definition of definitions) {
    const vector = artifact.vectors.find((candidate) => candidate.id === definition.id);
    if (!vector) throw new Error(`missing vector: ${definition.id}`);
    const hash = await hashDecisionPacketV1(vector.payload);
    if (
      hash.canonicalText !== vector.canonicalText
      || hash.utf8ByteLength !== vector.utf8ByteLength
      || hash.sha256 !== vector.sha256
    ) {
      throw new Error(`vector hash mismatch: ${definition.id}`);
    }
  }
}

if (process.argv.some((argument) => argument.endsWith("check-decision-packet-canonical-vectors.ts"))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
