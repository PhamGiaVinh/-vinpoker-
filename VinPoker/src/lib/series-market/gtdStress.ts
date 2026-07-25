import { canonicalHash } from "../series-intelligence/provenanceHash";
import type { HistoricalComparableQuantiles } from "./comparableResearchArtifact";
import {
  compareCanonicalStrings,
  normalizeCurrency,
  normalizeIntegerString,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";
import { SERIES_MARKET_RESEARCH_NAMESPACE } from "./researchRun";

export const GTD_STRESS_CONTRACT_VERSION = "v1" as const;
export const GTD_STRESS_CALCULATION_PROTOCOL_ID = "historical-gtd-stress" as const;
export const GTD_STRESS_CALCULATION_PROTOCOL_VERSION = "v1" as const;
export const GTD_STRESS_CONTRIBUTION_POLICY = "constant_per_entry_v1" as const;
export const GTD_STRESS_NAMESPACE =
  `${SERIES_MARKET_RESEARCH_NAMESPACE}:gtd-stress:${GTD_STRESS_CONTRACT_VERSION}` as const;

export type GtdStressEvidenceQuality = "verified" | "unverified";
export type GtdStressEvidenceState = "verified_evidence" | "unverified_evidence";
export type GtdStressMoneyEvidenceState = "resolved" | "missing" | "conflicting";
export type GtdStressQuantile = "p10" | "p25" | "p50" | "p75" | "p90";
export type GtdStressUnavailableReason =
  | "missing_gtd"
  | "missing_prize_contribution"
  | "zero_prize_contribution"
  | "currency_mismatch"
  | "invalid_scale"
  | "unavailable_historical_distribution"
  | "conflicting_evidence";

export interface GtdStressMoneyInput {
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
}

export interface GtdStressMoneyEvidenceInput {
  readonly state: GtdStressMoneyEvidenceState;
  readonly value: GtdStressMoneyInput | null;
  readonly claimIds: readonly string[];
}

export interface GtdStressComparableProvenance {
  readonly comparableAnalysisId: string;
  readonly selectionProtocolId: string;
  readonly distributionMethodId: string;
}

export interface GtdStressInput {
  readonly targetEventId: string;
  readonly sourceArtifactId: string;
  readonly comparableProvenance: GtdStressComparableProvenance;
  readonly gtd: GtdStressMoneyEvidenceInput;
  readonly prizeContributionPerEntry: GtdStressMoneyEvidenceInput;
  readonly historicalComparableQuantiles: HistoricalComparableQuantiles | null;
  readonly evidenceQuality: GtdStressEvidenceQuality;
  readonly calculationProtocolId: typeof GTD_STRESS_CALCULATION_PROTOCOL_ID;
  readonly calculationProtocolVersion: typeof GTD_STRESS_CALCULATION_PROTOCOL_VERSION;
}

export interface GtdStressMoney {
  readonly type: "money";
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
}

export interface GtdStressQuantileScenario {
  readonly label: "Historical Scenario";
  readonly quantile: GtdStressQuantile;
  readonly interpretation: "historical comparable field quantiles";
  readonly historicalFieldEntries: string;
  readonly historicalPrizeContribution: GtdStressMoney;
  readonly signedGtdGap: GtdStressMoney;
  readonly shortfallLabel: "Historical Shortfall";
  readonly shortfall: GtdStressMoney;
  readonly surplusLabel: "Historical Surplus";
  readonly surplus: GtdStressMoney;
  readonly requiredEntriesGap: string;
}

interface GtdStressScenarioBase {
  readonly scenarioId: string;
  readonly contractVersion: typeof GTD_STRESS_CONTRACT_VERSION;
  readonly label: "Historical GTD Stress";
  readonly targetEventId: string;
  readonly sourceArtifactId: string;
  readonly comparableProvenance: GtdStressComparableProvenance;
  readonly calculationProtocolId: typeof GTD_STRESS_CALCULATION_PROTOCOL_ID;
  readonly calculationProtocolVersion: typeof GTD_STRESS_CALCULATION_PROTOCOL_VERSION;
  readonly contributionPolicy: typeof GTD_STRESS_CONTRIBUTION_POLICY;
  readonly requiredFieldLabel: "Required Field";
  readonly prizeContributionLabel: "Prize Contribution per Entry";
  readonly gtdClaimIds: readonly string[];
  readonly prizeContributionClaimIds: readonly string[];
  readonly evidenceQuality: GtdStressEvidenceQuality;
  readonly evidenceState: GtdStressEvidenceState;
  readonly assumptionWarnings: readonly string[];
  readonly limitations: readonly string[];
  readonly allowedClaims: readonly string[];
  readonly forbiddenClaims: readonly string[];
}

export interface GtdStressScenario extends GtdStressScenarioBase {
  readonly state: "available";
  readonly gtd: GtdStressMoney;
  readonly prizeContributionPerEntry: GtdStressMoney;
  readonly calculationScale: number;
  readonly requiredEntries: string;
  readonly quantileScenarios: readonly GtdStressQuantileScenario[];
}

export interface GtdStressUnavailableState extends GtdStressScenarioBase {
  readonly state: "unavailable";
  readonly unavailableReason: GtdStressUnavailableReason;
  readonly gtd: GtdStressMoney | null;
  readonly prizeContributionPerEntry: GtdStressMoney | null;
  readonly calculationScale: null;
  readonly requiredEntries: null;
  readonly quantileScenarios: readonly [];
}

export type GtdStressResult = GtdStressScenario | GtdStressUnavailableState;

interface CanonicalMoneyEvidence {
  readonly state: GtdStressMoneyEvidenceState;
  readonly value: GtdStressMoney | null;
  readonly claimIds: readonly string[];
}

const QUANTILES: readonly GtdStressQuantile[] = ["p10", "p25", "p50", "p75", "p90"];

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

function containsForbiddenControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeReference(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 512 || containsForbiddenControl(value)) {
    fail(`${label} must be a non-blank canonical reference`, "INVALID_GTD_STRESS_REFERENCE");
  }
  return value;
}

function canonicalClaimIds(rawValues: readonly string[], label: string): readonly string[] {
  if (rawValues.length === 0) fail(`${label} must not be empty`, "GTD_STRESS_CLAIMS_REQUIRED");
  const values = rawValues.map((value) => normalizeReference(value, label));
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains a duplicate after normalization`, "DUPLICATE_GTD_STRESS_CLAIM");
    seen.add(value);
  }
  return values.sort(compareCanonicalStrings);
}

function normalizeEvidenceQuality(value: GtdStressEvidenceQuality): GtdStressEvidenceQuality {
  if (value !== "verified" && value !== "unverified") {
    fail("evidenceQuality is unsupported", "INVALID_GTD_STRESS_EVIDENCE_QUALITY");
  }
  return value;
}

function normalizeMoneyForIdentity(input: GtdStressMoneyInput, label: string): GtdStressMoney {
  if (!Number.isFinite(input.scale)) {
    fail(`${label}.scale must be finite`, "INVALID_GTD_STRESS_SCALE");
  }
  const minorUnits = normalizeIntegerString(input.minorUnits);
  if (BigInt(minorUnits) < 0n) fail(`${label} must not be negative`, "NEGATIVE_GTD_STRESS_MONEY");
  return {
    type: "money",
    minorUnits,
    currency: normalizeCurrency(input.currency),
    scale: input.scale,
  };
}

function normalizeMoneyEvidence(
  input: GtdStressMoneyEvidenceInput,
  label: string,
): CanonicalMoneyEvidence {
  if (input.state !== "resolved" && input.state !== "missing" && input.state !== "conflicting") {
    fail(`${label}.state is unsupported`, "INVALID_GTD_STRESS_EVIDENCE_STATE");
  }
  const claimIds = canonicalClaimIds(input.claimIds, `${label}.claimIds`);
  if (input.state === "resolved" && input.value === null) {
    fail(`${label}.value is required when evidence is resolved`, "MISSING_GTD_STRESS_MONEY");
  }
  if (input.state !== "resolved" && input.value !== null) {
    fail(`${label}.value must be null unless evidence is resolved`, "AMBIGUOUS_GTD_STRESS_MONEY");
  }
  return {
    state: input.state,
    value: input.value === null ? null : normalizeMoneyForIdentity(input.value, `${label}.value`),
    claimIds,
  };
}

function normalizeComparableProvenance(
  input: GtdStressComparableProvenance,
): GtdStressComparableProvenance {
  return {
    comparableAnalysisId: normalizeReference(input.comparableAnalysisId, "comparableAnalysisId"),
    selectionProtocolId: normalizeReference(input.selectionProtocolId, "selectionProtocolId"),
    distributionMethodId: normalizeReference(input.distributionMethodId, "distributionMethodId"),
  };
}

function normalizeQuantiles(
  input: HistoricalComparableQuantiles | null,
): HistoricalComparableQuantiles | null {
  if (input === null) return null;
  if (
    input.label !== "Historical Benchmark"
    || input.interpretation !== "historical comparable field quantiles"
  ) {
    fail("historical quantile labels are not canonical", "INVALID_GTD_STRESS_QUANTILE_LABEL");
  }
  const values = QUANTILES.map((quantile) => normalizeIntegerString(input[quantile]));
  if (values.some((value) => BigInt(value) < 0n)) {
    fail("historical field quantiles must not be negative", "NEGATIVE_GTD_STRESS_QUANTILE");
  }
  return {
    label: "Historical Benchmark",
    interpretation: "historical comparable field quantiles",
    p10: values[0],
    p25: values[1],
    p50: values[2],
    p75: values[3],
    p90: values[4],
  };
}

function hasValidScale(money: GtdStressMoney): boolean {
  return Number.isInteger(money.scale) && money.scale >= 0 && money.scale <= 18;
}

function money(minorUnits: bigint, currency: string, scale: number): GtdStressMoney {
  return {
    type: "money",
    minorUnits: minorUnits.toString(),
    currency,
    scale,
  };
}

function normalizeToScale(value: GtdStressMoney, scale: number): bigint {
  return BigInt(value.minorUnits) * (10n ** BigInt(scale - value.scale));
}

function ceilDivide(dividend: bigint, divisor: bigint): bigint {
  return dividend === 0n ? 0n : ((dividend - 1n) / divisor) + 1n;
}

function evidenceState(quality: GtdStressEvidenceQuality): GtdStressEvidenceState {
  return quality === "verified" ? "verified_evidence" : "unverified_evidence";
}

function limitations(quality: GtdStressEvidenceQuality): readonly string[] {
  const values = [
    "Historical comparable field quantiles are descriptive research inputs, not forward-looking estimates.",
    "The calculation assumes one constant prize contribution for every entry.",
    "Exact arithmetic does not establish causality or support an autonomous money decision.",
  ];
  if (quality === "unverified") {
    values.push("Source evidence is unverified and must not be treated as production decision evidence.");
  }
  return values.sort(compareCanonicalStrings);
}

const ALLOWED_CLAIMS = Object.freeze([
  "Each Historical Scenario applies one historical comparable field quantile.",
  "Historical Shortfall and Historical Surplus are exact arithmetic differences.",
  "Required Field is calculated from explicit GTD and Prize Contribution per Entry.",
].sort(compareCanonicalStrings));

const FORBIDDEN_CLAIMS = Object.freeze([
  "No causal, calibrated, or production forecasting claim is supported.",
  "No GTD optimization or recommendation claim is supported.",
  "No probability claim is supported.",
].sort(compareCanonicalStrings));

const ASSUMPTION_WARNINGS = Object.freeze([
  "Assumes a constant prize contribution per entry.",
]);

function unavailableReason(
  gtd: CanonicalMoneyEvidence,
  contribution: CanonicalMoneyEvidence,
  quantiles: HistoricalComparableQuantiles | null,
): GtdStressUnavailableReason | null {
  if (gtd.state === "conflicting" || contribution.state === "conflicting") return "conflicting_evidence";
  if (gtd.state === "missing") return "missing_gtd";
  if (contribution.state === "missing") return "missing_prize_contribution";
  if (gtd.value === null || contribution.value === null) return "conflicting_evidence";
  if (!hasValidScale(gtd.value) || !hasValidScale(contribution.value)) return "invalid_scale";
  if (gtd.value.currency !== contribution.value.currency) return "currency_mismatch";
  if (BigInt(contribution.value.minorUnits) === 0n) return "zero_prize_contribution";
  if (quantiles === null) return "unavailable_historical_distribution";
  const ordered = QUANTILES.map((quantile) => BigInt(quantiles[quantile]));
  if (ordered.some((value, index) => index > 0 && value < ordered[index - 1])) {
    return "unavailable_historical_distribution";
  }
  return null;
}

export async function createGtdStressScenario(input: GtdStressInput): Promise<GtdStressResult> {
  const targetEventId = normalizeReference(input.targetEventId, "targetEventId");
  const sourceArtifactId = normalizeReference(input.sourceArtifactId, "sourceArtifactId");
  const comparableProvenance = normalizeComparableProvenance(input.comparableProvenance);
  const gtd = normalizeMoneyEvidence(input.gtd, "gtd");
  const prizeContribution = normalizeMoneyEvidence(
    input.prizeContributionPerEntry,
    "prizeContributionPerEntry",
  );
  const historicalComparableQuantiles = normalizeQuantiles(input.historicalComparableQuantiles);
  const quality = normalizeEvidenceQuality(input.evidenceQuality);
  const calculationProtocolId = normalizeStableKey(
    input.calculationProtocolId,
    "calculationProtocolId",
  );
  const calculationProtocolVersion = normalizeStableKey(
    input.calculationProtocolVersion,
    "calculationProtocolVersion",
  );
  if (
    calculationProtocolId !== GTD_STRESS_CALCULATION_PROTOCOL_ID
    || calculationProtocolVersion !== GTD_STRESS_CALCULATION_PROTOCOL_VERSION
  ) {
    fail("unsupported GTD Stress calculation protocol", "UNSUPPORTED_GTD_STRESS_PROTOCOL");
  }

  const semanticInput = {
    contractVersion: GTD_STRESS_CONTRACT_VERSION,
    targetEventId,
    sourceArtifactId,
    comparableProvenance,
    gtd,
    prizeContributionPerEntry: prizeContribution,
    historicalComparableQuantiles,
    evidenceQuality: quality,
    calculationProtocolId,
    calculationProtocolVersion,
    contributionPolicy: GTD_STRESS_CONTRIBUTION_POLICY,
  };
  const scenarioId = `${GTD_STRESS_NAMESPACE}:${await canonicalHash({
    namespace: GTD_STRESS_NAMESPACE,
    ...semanticInput,
  })}`;

  const base: GtdStressScenarioBase = {
    scenarioId,
    contractVersion: GTD_STRESS_CONTRACT_VERSION,
    label: "Historical GTD Stress",
    targetEventId,
    sourceArtifactId,
    comparableProvenance,
    calculationProtocolId: GTD_STRESS_CALCULATION_PROTOCOL_ID,
    calculationProtocolVersion: GTD_STRESS_CALCULATION_PROTOCOL_VERSION,
    contributionPolicy: GTD_STRESS_CONTRIBUTION_POLICY,
    requiredFieldLabel: "Required Field",
    prizeContributionLabel: "Prize Contribution per Entry",
    gtdClaimIds: gtd.claimIds,
    prizeContributionClaimIds: prizeContribution.claimIds,
    evidenceQuality: quality,
    evidenceState: evidenceState(quality),
    assumptionWarnings: ASSUMPTION_WARNINGS,
    limitations: limitations(quality),
    allowedClaims: ALLOWED_CLAIMS,
    forbiddenClaims: FORBIDDEN_CLAIMS,
  };

  const reason = unavailableReason(gtd, prizeContribution, historicalComparableQuantiles);
  if (reason !== null) {
    return deepFreeze({
      ...base,
      state: "unavailable",
      unavailableReason: reason,
      gtd: gtd.value,
      prizeContributionPerEntry: prizeContribution.value,
      calculationScale: null,
      requiredEntries: null,
      quantileScenarios: [],
    });
  }

  const gtdMoney = gtd.value as GtdStressMoney;
  const contributionMoney = prizeContribution.value as GtdStressMoney;
  const quantiles = historicalComparableQuantiles as HistoricalComparableQuantiles;
  const calculationScale = Math.max(gtdMoney.scale, contributionMoney.scale);
  const normalizedGtd = normalizeToScale(gtdMoney, calculationScale);
  const normalizedContribution = normalizeToScale(contributionMoney, calculationScale);
  const requiredEntries = ceilDivide(normalizedGtd, normalizedContribution);

  const quantileScenarios = QUANTILES.map((quantile): GtdStressQuantileScenario => {
    const historicalFieldEntries = BigInt(quantiles[quantile]);
    const historicalPrizeContribution = historicalFieldEntries * normalizedContribution;
    const signedGtdGap = historicalPrizeContribution - normalizedGtd;
    const shortfall = signedGtdGap < 0n ? -signedGtdGap : 0n;
    const surplus = signedGtdGap > 0n ? signedGtdGap : 0n;
    return {
      label: "Historical Scenario",
      quantile,
      interpretation: "historical comparable field quantiles",
      historicalFieldEntries: historicalFieldEntries.toString(),
      historicalPrizeContribution: money(
        historicalPrizeContribution,
        gtdMoney.currency,
        calculationScale,
      ),
      signedGtdGap: money(signedGtdGap, gtdMoney.currency, calculationScale),
      shortfallLabel: "Historical Shortfall",
      shortfall: money(shortfall, gtdMoney.currency, calculationScale),
      surplusLabel: "Historical Surplus",
      surplus: money(surplus, gtdMoney.currency, calculationScale),
      requiredEntriesGap: (historicalFieldEntries - requiredEntries).toString(),
    };
  });

  return deepFreeze({
    ...base,
    state: "available",
    gtd: gtdMoney,
    prizeContributionPerEntry: contributionMoney,
    calculationScale,
    requiredEntries: requiredEntries.toString(),
    quantileScenarios,
  });
}
