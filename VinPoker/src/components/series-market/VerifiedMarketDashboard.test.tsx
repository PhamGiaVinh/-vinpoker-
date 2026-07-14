import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createVerifiedJejuReadModel,
  type VerifiedEventRow,
  type VerifiedField,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { VerifiedMarketDashboard } from "./VerifiedMarketDashboard";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

let model: VerifiedMarketReadModel;

beforeAll(async () => {
  model = await createVerifiedJejuReadModel({
    canonicalImport: artifact("canonical/jeju_import_v1.json"),
    release: artifact("release.json"),
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
}, 30_000);

afterEach(cleanup);

describe("VerifiedMarketDashboard", () => {
  it("shows the seed caveat, release counts, and data-quality limitations", () => {
    render(<VerifiedMarketDashboard model={model} />);
    expect(screen.getByText("Verified Market · Jeju V1")).toBeInTheDocument();
    expect(screen.getByText("Unverified public seed")).toBeInTheDocument();
    expect(screen.getByText(/not official ground truth/i)).toBeInTheDocument();
    expect(screen.getByText("972")).toBeInTheDocument();
    expect(screen.getByText("178")).toBeInTheDocument();
    expect(screen.getByText("KRW, USD")).toBeInTheDocument();
    expect(screen.getByText(/No row-level official URLs are available/)).toBeInTheDocument();
    expect(screen.getByText("value_ratio")).toBeInTheDocument();
    expect(screen.getByText(/794 non-missing/)).toBeInTheDocument();
    expect(screen.getAllByText("Prize contribution").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Flagship").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Derived UI Count").length).toBeGreaterThan(0);
  });

  it("filters by text and renders an honest no-results state", () => {
    render(<VerifiedMarketDashboard model={model} />);
    fireEvent.change(screen.getByPlaceholderText("Event, festival, venue..."), { target: { value: "no-such-public-event" } });
    expect(screen.getByTestId("market-no-results")).toBeInTheDocument();
    expect(screen.getByText(/No values were fabricated/)).toBeInTheDocument();
  });

  it("opens Source Detail with claim and source-revision lineage", () => {
    render(<VerifiedMarketDashboard model={model} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Open Source Detail for Event name/ })[0]!);
    expect(screen.getByTestId("evidence-sheet")).toBeInTheDocument();
    expect(screen.getByText("Source Detail")).toBeInTheDocument();
    expect(screen.getByText("Evidence claim 1")).toBeInTheDocument();
    expect(screen.getByText(model.sourceRevision.id)).toBeInTheDocument();
    expect(screen.getByText("other_public")).toBeInTheDocument();
    expect(screen.getByText("owner-provided seed dataset")).toBeInTheDocument();
  }, 20_000);

  it("surfaces missing evidence distinctly from zero", () => {
    render(<VerifiedMarketDashboard model={model} />);
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/missing/).length).toBeGreaterThan(0);
    expect(screen.queryByText("KRW 0")).not.toBeInTheDocument();
  });

  it("shows every incompatible value in a conflict fixture", () => {
    const event = model.events[0]!;
    const original = event.fields.event_name;
    const detail = original.evidence[0]!;
    const conflictField: VerifiedField = {
      ...original,
      state: "conflict",
      value: null,
      displayValue: "Conflict",
      activeClaimIds: ["claim-alpha", "claim-beta"],
      evidence: [
        { ...detail, claimId: "claim-alpha", normalizedValue: { type: "text", value: "Alpha source" }, rawValue: "Alpha source" },
        { ...detail, claimId: "claim-beta", normalizedValue: { type: "text", value: "Beta source" }, rawValue: "Beta source" },
      ],
    };
    const conflictEvent: VerifiedEventRow = {
      ...event,
      conflictFieldCount: 1,
      fields: { ...event.fields, event_name: conflictField },
    };
    const conflictModel: VerifiedMarketReadModel = { ...model, events: [conflictEvent, ...model.events.slice(1)] };
    render(<VerifiedMarketDashboard model={conflictModel} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Open Source Detail for Event name: Conflict/ })[0]!);
    expect(screen.getAllByText("Conflict").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alpha source").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta source").length).toBeGreaterThan(0);
    expect(screen.getByText("claim-alpha")).toBeInTheDocument();
    expect(screen.getByText("claim-beta")).toBeInTheDocument();
  }, 20_000);
});
