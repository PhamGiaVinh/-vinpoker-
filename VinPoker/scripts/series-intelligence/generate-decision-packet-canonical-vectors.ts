import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DECISION_PACKET_HASH_CONTRACT_VERSION,
  hashDecisionPacketV1,
} from "../../src/lib/series-intelligence/decisionPacketCanonicalV1";
import { buildDecisionPacketCanonicalVectorDefinitions } from "../../src/lib/series-intelligence/decisionPacketCanonicalVectors";

const artifactPath = resolve(
  import.meta.dirname,
  "../../src/lib/series-intelligence/fixtures/decisionPacketCanonicalV1.vectors.json",
);

export interface DecisionPacketCanonicalVectorArtifact {
  readonly artifactVersion: "series-decision-packet-canonical-v1";
  readonly hashContractVersion: typeof DECISION_PACKET_HASH_CONTRACT_VERSION;
  readonly vectors: readonly {
    readonly id: string;
    readonly payload: unknown;
    readonly canonicalText: string;
    readonly utf8ByteLength: number;
    readonly sha256: string;
  }[];
}

export async function buildDecisionPacketCanonicalVectorArtifact(): Promise<DecisionPacketCanonicalVectorArtifact> {
  const definitions = await buildDecisionPacketCanonicalVectorDefinitions();
  const vectors = await Promise.all(definitions.map(async (definition) => {
    const hash = await hashDecisionPacketV1(definition.payload);
    return {
      id: definition.id,
      payload: definition.payload,
      canonicalText: hash.canonicalText,
      utf8ByteLength: hash.utf8ByteLength,
      sha256: hash.sha256,
    } as const;
  }));
  return {
    artifactVersion: "series-decision-packet-canonical-v1",
    hashContractVersion: DECISION_PACKET_HASH_CONTRACT_VERSION,
    vectors,
  };
}

export async function renderDecisionPacketCanonicalVectorArtifact(): Promise<string> {
  return `${JSON.stringify(await buildDecisionPacketCanonicalVectorArtifact(), null, 2)}\n`;
}

async function main(): Promise<void> {
  const checkOnly = process.argv.slice(2).includes("--check");
  const unsupported = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unsupported.length > 0) {
    throw new Error(`unsupported arguments: ${unsupported.join(", ")}`);
  }
  const rendered = await renderDecisionPacketCanonicalVectorArtifact();
  if (checkOnly) {
    const current = await readFile(artifactPath, "utf8");
    if (current !== rendered) {
      throw new Error("decision packet canonical vector artifact is stale; rerun the generator");
    }
    return;
  }
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, rendered, "utf8");
}

if (process.argv.some((argument) => argument.endsWith("generate-decision-packet-canonical-vectors.ts"))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
