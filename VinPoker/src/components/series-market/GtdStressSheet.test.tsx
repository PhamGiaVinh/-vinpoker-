import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createGtdStressEventReadModel,
  createJejuGtdStressResearchContext,
  getGtdStressEventEligibility,
  type GtdStressEventReadModel,
} from "@/lib/series-market/gtdStressUiReadModel";
import { SeriesMarketValidationError } from "@/lib/series-market/normalization";
import {
  createVerifiedJejuReadModel,
  type VerifiedEventRow,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { GtdStressSheet } from "./GtdStressSheet";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

let model: VerifiedMarketReadModel;
let missingEvent!: VerifiedEventRow;
let availableEvent!: VerifiedEventRow;
let availableReadModel!: Extract<GtdStressEventReadModel, { state: "research" }>;
let unavailableReadModel!: Extract<GtdStressEventReadModel, { state: "research" }>;

beforeAll(async () => {
  const canonicalImport = artifact("canonical/jeju_import_v1.json");
  const datasetRelease = artifact("release.json");
  model = await createVerifiedJejuReadModel({
    canonicalImport,
    release: datasetRelease,
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
  const context = await createJejuGtdStressResearchContext({
    model,
    rawBundle: readFileSync(
      join(RELEASE_ROOT, "research/comparable-v0-exact-v1.json"),
      "utf8",
    ),
    canonicalImport,
    datasetRelease,
  });

  missingEvent = model.events.find(
    (event) => getGtdStressEventEligibility(event).state === "requirements_missing",
  )!;
  for (const eventId of context.readyEventIds) {
    const event = model.events.find((candidate) => candidate.id === eventId)!;
    const readModel = await createGtdStressEventReadModel(context, eventId);
    if (readModel.state !== "research") continue;
    if (readModel.result.scenario.state === "available" && !availableReadModel) {
      availableEvent = event;
      availableReadModel = readModel;
    }
  }
  expect(availableEvent).toBeDefined();
  expect(availableReadModel).toBeDefined();

  const availableScenario = availableReadModel.result.scenario;
  if (availableScenario.state !== "available") throw new Error("available fixture missing");
  unavailableReadModel = Object.freeze({
    ...availableReadModel,
    result: Object.freeze({
      ...availableReadModel.result,
      scenario: Object.freeze({
        ...availableScenario,
        state: "unavailable" as const,
        unavailableReason: "unavailable_historical_distribution" as const,
        calculationScale: null,
        requiredEntries: null,
        quantileScenarios: Object.freeze([]),
      }),
    }),
  });
}, 90_000);

afterEach(cleanup);

describe("GtdStressSheet", () => {
  it("shows missing requirements without invoking the research adapter", () => {
    const loadResearch = vi.fn();
    render(
      <GtdStressSheet
        event={missingEvent}
        loadResearch={loadResearch}
        onOpenChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("gtd-stress-requirements")).toBeInTheDocument();
    expect(screen.getByText("Research inputs are incomplete")).toBeInTheDocument();
    expect(screen.getByText(/No partial scenario was calculated/)).toBeInTheDocument();
    expect(loadResearch).not.toHaveBeenCalled();
  });

  it("renders exact historical scenarios with unverified evidence labels", async () => {
    const loadResearch = vi.fn().mockResolvedValue(availableReadModel);
    render(
      <GtdStressSheet
        event={availableEvent}
        loadResearch={loadResearch}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("gtd-stress-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("gtd-stress-table")).toBeInTheDocument());
    expect(loadResearch).toHaveBeenCalledWith(availableEvent.id);
    expect(screen.getByText("Required Field")).toBeInTheDocument();
    expect(screen.getByText("Prize Contribution per Entry")).toBeInTheDocument();
    expect(screen.getAllByText(/historical comparable field quantiles/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unverified/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/recommended GTD/i)).not.toBeInTheDocument();
  });

  it("fails closed when trusted evidence validation rejects", async () => {
    const loadResearch = vi.fn().mockRejectedValue(
      new SeriesMarketValidationError("test failure", "TEST_RESEARCH_REJECTED"),
    );
    render(
      <GtdStressSheet
        event={availableEvent}
        loadResearch={loadResearch}
        onOpenChange={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("gtd-stress-error")).toBeInTheDocument());
    expect(screen.getByText("TEST_RESEARCH_REJECTED")).toBeInTheDocument();
    expect(screen.getByText(/No scenario or partial value/)).toBeInTheDocument();
    expect(screen.queryByTestId("gtd-stress-table")).not.toBeInTheDocument();
  });

  it("preserves an unavailable historical distribution without substitutes", async () => {
    render(
      <GtdStressSheet
        event={availableEvent}
        loadResearch={vi.fn().mockResolvedValue(unavailableReadModel)}
        onOpenChange={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("gtd-stress-unavailable")).toBeInTheDocument());
    expect(screen.getByText(/No substitute value was created/)).toBeInTheDocument();
    expect(screen.queryByTestId("gtd-stress-table")).not.toBeInTheDocument();
  });
});
