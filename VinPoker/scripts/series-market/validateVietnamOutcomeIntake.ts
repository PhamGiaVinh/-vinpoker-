import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import {
  createOutcomeIntakeRecord,
  OUTCOME_APPROVED_MEDIA_TYPES,
  OUTCOME_CLAIM_STATES,
  OUTCOME_EVIDENCE_QUALITIES,
  OUTCOME_EXTRACTION_METHODS,
  OUTCOME_EXTRACTION_STATUSES,
  OUTCOME_FIELD_KEYS,
  OUTCOME_REVIEWER_STATUSES,
  OUTCOME_SOURCE_CATEGORIES,
  OUTCOME_VALUE_SCOPE_BASES,
  type OutcomeIntakeRecordInput,
} from "../../src/lib/series-market/vietnamOutcomeEvidence";
import { SeriesMarketValidationError } from "../../src/lib/series-market/normalization";

const ROOT = process.cwd().endsWith("VinPoker")
  ? process.cwd()
  : resolve(process.cwd(), "VinPoker");
const TEMPLATE_PATH = resolve(
  ROOT,
  "src/lib/series-market/fixtures/templates/vietnam-outcome-intake.template.json",
);

const PRIVATE_FIELD_KEYS = new Set([
  "accountid",
  "address",
  "bankaccount",
  "clubid",
  "email",
  "operatorid",
  "paymentid",
  "phone",
  "playeremail",
  "playerid",
  "playeridentifier",
  "playername",
  "registrationid",
  "telegramid",
  "userid",
]);

const publicationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), value: z.string() }).strict(),
  z.object({ kind: z.literal("not_reported") }).strict(),
]);

const repositorySourceSchema = z.object({
  kind: z.literal("repository_file"),
  path: z.string(),
  sha256: z.string(),
  byteLength: z.string(),
  mediaType: z.enum(OUTCOME_APPROVED_MEDIA_TYPES),
}).strict();

const publicUrlSourceSchema = z.object({
  kind: z.literal("public_url"),
  url: z.string(),
  sha256: z.string().nullable(),
  byteLength: z.string().nullable(),
  mediaType: z.enum(OUTCOME_APPROVED_MEDIA_TYPES).nullable(),
}).strict();

const sourceSchema = z.object({
  sourceKey: z.string(),
  sourceCategory: z.enum(OUTCOME_SOURCE_CATEGORIES),
  sourceIdentity: z.discriminatedUnion("kind", [
    repositorySourceSchema,
    publicUrlSourceSchema,
  ]),
  organizer: z.string(),
  seriesName: z.string(),
  eventName: z.string().nullable(),
  publication: publicationSchema,
  capturedAt: z.string(),
  expectedCompetitionKey: z.string().nullable(),
  reviewerStatus: z.enum(OUTCOME_REVIEWER_STATUSES),
  evidenceQuality: z.enum(OUTCOME_EVIDENCE_QUALITIES),
  limitationNotes: z.array(z.string()),
}).strict();

const textValueSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
}).strict();
const integerValueSchema = z.object({
  type: z.literal("integer"),
  value: z.string(),
}).strict();
const moneyValueSchema = z.object({
  type: z.literal("money"),
  minorUnits: z.string(),
  currency: z.string(),
  scale: z.number(),
}).strict();
const localDateValueSchema = z.object({
  type: z.literal("local_date"),
  value: z.string(),
}).strict();
const claimValueSchema = z.discriminatedUnion("type", [
  textValueSchema,
  integerValueSchema,
  moneyValueSchema,
  localDateValueSchema,
]);
const scopeSchema = z.object({
  basis: z.enum(OUTCOME_VALUE_SCOPE_BASES),
  scopeIdentity: z.string(),
}).strict();

const intakeClaimSchema = z.object({
  field: z.enum(OUTCOME_FIELD_KEYS),
  state: z.enum(OUTCOME_CLAIM_STATES),
  value: claimValueSchema.nullable(),
  scope: scopeSchema.nullable(),
  visualOrTextRegion: z.string(),
  extractionMethod: z.enum(OUTCOME_EXTRACTION_METHODS),
  extractionStatus: z.enum(OUTCOME_EXTRACTION_STATUSES),
}).strict();

const outcomeSchema = z.object({
  outcomeEventKey: z.string(),
  organizer: z.string(),
  seriesName: z.string(),
  eventName: z.string(),
  eventDate: z.string(),
  flightIdentity: z.string().nullable(),
  currency: z.string().nullable(),
}).strict();

const linkageSchema = z.object({
  expectedCompetitionKey: z.string().nullable(),
  sourceDeclaredCompetitionKey: z.string().nullable(),
}).strict();

const intakeSchema = z.object({
  intakeKey: z.string(),
  fixtureOnly: z.boolean(),
  source: sourceSchema,
  outcome: outcomeSchema,
  claims: z.array(intakeClaimSchema),
  linkage: linkageSchema,
  reviewerStatus: z.enum(OUTCOME_REVIEWER_STATUSES),
  limitationNotes: z.array(z.string()),
}).strict();

const templateSchema = intakeSchema.extend({
  templateOnly: z.literal(true),
  warning: z.string(),
}).strict();

function normalizedPrivateKey(raw: string): string {
  return raw.normalize("NFC").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function rejectPrivateFieldLiterals(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateFieldLiterals(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_FIELD_KEYS.has(normalizedPrivateKey(key))) {
      throw new SeriesMarketValidationError(
        `private field literal is forbidden at ${path}.${key}`,
        "OUTCOME_PRIVATE_FIELD_FORBIDDEN",
      );
    }
    rejectPrivateFieldLiterals(nested, `${path}.${key}`);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SeriesMarketValidationError(
      "outcome intake file is not valid JSON",
      "INVALID_OUTCOME_INTAKE_JSON",
    );
  }
}

function assertOutcomeIntakeRecordInput(
  value: unknown,
): asserts value is OutcomeIntakeRecordInput {
  const parsed = intakeSchema.safeParse(value);
  if (!parsed.success) throw parsed.error;
}

export async function parseVietnamOutcomeIntake(
  raw: unknown,
): Promise<string> {
  rejectPrivateFieldLiterals(raw);
  assertOutcomeIntakeRecordInput(raw);
  return canonicalize(await createOutcomeIntakeRecord(raw));
}

export async function validateVietnamOutcomeIntakePath(
  inputPath: string,
): Promise<string> {
  const path = resolve(inputPath);
  const raw = readFileSync(path, "utf8");
  return parseVietnamOutcomeIntake(parseJson(raw));
}

export async function validateVietnamOutcomeIntakeTemplate(): Promise<string> {
  const raw = parseJson(readFileSync(TEMPLATE_PATH, "utf8"));
  rejectPrivateFieldLiterals(raw);
  const parsed = templateSchema.parse(raw);
  if (!parsed.warning.includes("FICTIONAL")) {
    throw new SeriesMarketValidationError(
      "Outcome intake template must remain explicitly fictional.",
      "OUTCOME_TEMPLATE_NOT_FICTIONAL",
    );
  }
  const {
    templateOnly: _templateOnly,
    warning: _warning,
    ...input
  } = parsed;
  assertOutcomeIntakeRecordInput(input);
  const record = await createOutcomeIntakeRecord(input);
  if (
    record.fixtureOnly !== true
    || record.source.reviewerStatus !== "intake"
    || !record.intakeKey.startsWith("fixture.")
  ) {
    throw new SeriesMarketValidationError(
      "Outcome intake template must never be eligible for a release.",
      "OUTCOME_TEMPLATE_RELEASE_ELIGIBLE",
    );
  }
  return canonicalize(record);
}

export type VietnamOutcomeIntakeExitCode = 0 | 2 | 3 | 64;

export function classifyVietnamOutcomeIntakeError(error: unknown): 2 | 3 {
  if (
    error instanceof SeriesMarketValidationError
    || error instanceof ZodError
    || error instanceof SyntaxError
  ) {
    return 2;
  }
  if (
    error !== null
    && typeof error === "object"
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    return 3;
  }
  return 3;
}

export async function runVietnamOutcomeIntakeCli(
  args: readonly string[],
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  errorOutput: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): Promise<VietnamOutcomeIntakeExitCode> {
  let task: Promise<string>;
  if (args.length === 1 && args[0] === "--check-template") {
    task = validateVietnamOutcomeIntakeTemplate();
  } else if (args.length === 2 && args[0] === "--input" && args[1].trim() !== "") {
    task = validateVietnamOutcomeIntakePath(args[1]);
  } else {
    errorOutput.write(
      "Usage: --check-template | --input <path>. This command never emits an outcome release.\n",
    );
    return 64;
  }
  try {
    await task;
    output.write("Vietnam outcome intake valid.\n");
    return 0;
  } catch (error: unknown) {
    errorOutput.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return classifyVietnamOutcomeIntakeError(error);
  }
}

const invokedDirectly = process.argv[1]
  ?.replace(/\\/g, "/")
  .endsWith("/validateVietnamOutcomeIntake.ts") === true;

if (invokedDirectly) {
  runVietnamOutcomeIntakeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 3;
    });
}
