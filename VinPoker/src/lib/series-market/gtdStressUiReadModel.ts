import { sha256Hex } from "../series-intelligence/provenanceHash";
import type { DatasetRelease, SourceClaim } from "./contracts";
import { validateJejuDatasetRelease } from "./datasetRelease";
import {
  type ComparableV0ResearchBundle,
  type FoldPrediction,
} from "./comparableResearchArtifact";
import {
  createGtdStressScenarioFromComparableArtifact,
  type GtdStressFromComparableArtifactResult,
} from "./gtdStressComparableAdapter";
import {
  parseJejuImportJson,
  type JejuImportDataset,
  type JejuImportJsonDocument,
} from "./importer";
import { SeriesMarketValidationError } from "./normalization";
import type {
  EvidenceState,
  VerifiedEventRow,
  VerifiedMarketReadModel,
} from "./verifiedMarketReadModel";

export const GTD_STRESS_UI_EVALUATION_PROTOCOL_ID = "chronological-v1" as const;
export const GTD_STRESS_UI_BUNDLE_FILE_SHA256 =
  "0a0fecfe5524974be97d64f75ddfcad80cb837814d1a9259ffc5375ed7a51bbb" as const;

export type GtdStressRequirementKey = "gtd" | "buy_in_prize";

export interface GtdStressRequirement {
  readonly key: GtdStressRequirementKey;
  readonly label: "GTD" | "Prize Contribution per Entry";
  readonly state: EvidenceState;
  readonly displayValue: string;
}

export interface GtdStressEventEligibility {
  readonly state: "ready" | "requirements_missing";
  readonly requirements: readonly GtdStressRequirement[];
}

export interface JejuGtdStressResearchContext {
  readonly artifactFileSha256: typeof GTD_STRESS_UI_BUNDLE_FILE_SHA256;
  readonly model: VerifiedMarketReadModel;
  readonly datasetRelease: DatasetRelease;
  readonly dataset: JejuImportDataset;
  readonly bundle: ComparableV0ResearchBundle;
  readonly readyEventIds: readonly string[];
}

export interface GtdStressRequirementsMissingReadModel {
  readonly state: "requirements_missing";
  readonly targetEventId: string;
  readonly eventTitle: string;
  readonly eligibility: GtdStressEventEligibility;
}

export interface GtdStressResearchReadModel {
  readonly state: "research";
  readonly targetEventId: string;
  readonly eventTitle: string;
  readonly eligibility: GtdStressEventEligibility;
  readonly artifactFileSha256: typeof GTD_STRESS_UI_BUNDLE_FILE_SHA256;
  readonly evidenceN: number;
  readonly result: GtdStressFromComparableArtifactResult;
}

export type GtdStressEventReadModel =
  | GtdStressRequirementsMissingReadModel
  | GtdStressResearchReadModel;

const REQUIREMENTS: readonly GtdStressRequirementKey[] = ["gtd", "buy_in_prize"];

function fail(message: string, code: string): never {
  throw new SeriesMarketValidationError(message, code);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function eventTitle(event: VerifiedEventRow): string {
  return `${event.eventDate} | #${event.eventNumber} | ${event.eventName}`;
}

function requirement(event: VerifiedEventRow, key: GtdStressRequirementKey): GtdStressRequirement {
  const field = event.fields[key];
  return {
    key,
    label: key === "gtd" ? "GTD" : "Prize Contribution per Entry",
    state: field.state,
    displayValue: field.displayValue,
  };
}

export function getGtdStressEventEligibility(
  event: VerifiedEventRow,
): GtdStressEventEligibility {
  const requirements = REQUIREMENTS.map((key) => requirement(event, key));
  return deepFreeze({
    state: requirements.every((item) => item.state === "resolved")
      ? "ready"
      : "requirements_missing",
    requirements,
  });
}

export function countGtdStressReadyEvents(events: readonly VerifiedEventRow[]): number {
  return events.filter((event) => getGtdStressEventEligibility(event).state === "ready").length;
}

function parseBundle(rawBundle: string): ComparableV0ResearchBundle {
  try {
    return deepFreeze(JSON.parse(rawBundle) as ComparableV0ResearchBundle);
  } catch {
    fail("committed Comparable bundle is not valid JSON", "GTD_STRESS_UI_BUNDLE_INVALID_JSON");
  }
}

export async function createJejuGtdStressResearchContext(input: {
  readonly model: VerifiedMarketReadModel;
  readonly rawBundle: string;
  readonly canonicalImport: unknown;
  readonly datasetRelease: unknown;
}): Promise<JejuGtdStressResearchContext> {
  const artifactFileSha256 = await sha256Hex(input.rawBundle);
  if (artifactFileSha256 !== GTD_STRESS_UI_BUNDLE_FILE_SHA256) {
    fail("committed Comparable bundle file hash does not match", "GTD_STRESS_UI_BUNDLE_HASH_MISMATCH");
  }

  const datasetRelease = input.datasetRelease as DatasetRelease;
  const parsed = await parseJejuImportJson(input.canonicalImport as JejuImportJsonDocument);
  if (!parsed.ok) {
    fail(
      `GTD Stress canonical import rejected: ${parsed.errors[0]?.code ?? "unknown"}`,
      "GTD_STRESS_UI_CANONICAL_IMPORT_INVALID",
    );
  }
  await validateJejuDatasetRelease(parsed.value, datasetRelease);
  if (datasetRelease.id !== input.model.releaseId) {
    fail("GTD Stress release does not match the Verified Market model", "GTD_STRESS_UI_RELEASE_MISMATCH");
  }

  const bundle = parseBundle(input.rawBundle);
  const readyEventIds = input.model.events
    .filter((event) => getGtdStressEventEligibility(event).state === "ready")
    .map((event) => event.id);

  return deepFreeze({
    artifactFileSha256: GTD_STRESS_UI_BUNDLE_FILE_SHA256,
    model: input.model,
    datasetRelease,
    dataset: parsed.value,
    bundle,
    readyEventIds,
  });
}

function claimsFor(
  claims: readonly SourceClaim[],
  eventId: string,
  field: GtdStressRequirementKey,
): readonly SourceClaim[] {
  return claims.filter((claim) => claim.entityId === eventId && claim.field === field);
}

function selectChronologicalFold(
  bundle: ComparableV0ResearchBundle,
  targetEventId: string,
): FoldPrediction {
  const matches = bundle.artifact.payload.foldPredictions.filter(
    (fold) =>
      fold.targetEventId === targetEventId
      && fold.evaluationProtocolId === GTD_STRESS_UI_EVALUATION_PROTOCOL_ID,
  );
  if (matches.length !== 1) {
    fail(
      "GTD Stress requires exactly one chronological Comparable fold",
      "GTD_STRESS_UI_FOLD_CARDINALITY",
    );
  }
  return matches[0]!;
}

export async function createGtdStressEventReadModel(
  context: JejuGtdStressResearchContext,
  targetEventId: string,
): Promise<GtdStressEventReadModel> {
  const matches = context.model.events.filter((event) => event.id === targetEventId);
  if (matches.length !== 1) {
    fail("GTD Stress target event is unknown or duplicated", "GTD_STRESS_UI_EVENT_CARDINALITY");
  }
  const event = matches[0]!;
  const eligibility = getGtdStressEventEligibility(event);
  if (eligibility.state !== "ready") {
    return deepFreeze({
      state: "requirements_missing",
      targetEventId: event.id,
      eventTitle: eventTitle(event),
      eligibility,
    });
  }

  const fold = selectChronologicalFold(context.bundle, event.id);
  const result = await createGtdStressScenarioFromComparableArtifact({
    bundle: context.bundle,
    datasetRelease: context.datasetRelease,
    targetEventId: event.id,
    foldId: fold.foldId,
    gtdClaims: claimsFor(context.dataset.claims, event.id, "gtd"),
    prizeContributionClaims: claimsFor(
      context.dataset.claims,
      event.id,
      "buy_in_prize",
    ),
  });

  return deepFreeze({
    state: "research",
    targetEventId: event.id,
    eventTitle: eventTitle(event),
    eligibility,
    artifactFileSha256: context.artifactFileSha256,
    evidenceN: fold.selectedComparableIds.length,
    result,
  });
}
