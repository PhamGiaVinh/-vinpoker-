import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createVietnamSupplyReadModel,
  type VietnamSupplyReadModel,
} from "@/lib/series-market/vietnamSupplyReadModel";
import { VietnamMarketPulse } from "./VietnamMarketPulse";
import { VietnamSupplyContent } from "./VietnamSupplyContent";
import { VietnamSupplyDashboard } from "./VietnamSupplyDashboard";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const DATASET = join(
  APP_ROOT,
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1",
);

const json = (path: string) => JSON.parse(readFileSync(join(DATASET, path), "utf8")) as unknown;
let model: VietnamSupplyReadModel;

beforeAll(async () => {
  model = await createVietnamSupplyReadModel({
    rawArtifact: readFileSync(join(DATASET, "research/schedule-supply-v1.json"), "utf8"),
    release: json("release.json"),
    receipt: json("research/schedule-supply-v1.receipt.json"),
    correction: json("corrections/d1a-correction-001-center-p-after-dark.json"),
  });
}, 30_000);

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

describe("VietnamSupplyDashboard", () => {
  it("renders released overview truth and keeps demand intelligence unavailable", () => {
    const { container } = render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getByText("Vietnam Market Supply")).toBeInTheDocument();
    expect(screen.getAllByText(/Owner-provided public images/i).length).toBeGreaterThan(0);
    expect(screen.getByText("26.559.000.000 ₫")).toBeInTheDocument();
    expect(screen.getAllByText("2271").length).toBeGreaterThan(0);
    expect(screen.getByText("Calculable required entries")).toBeInTheDocument();
    expect(screen.getByText(/player-flow intelligence are unavailable/i)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  }, 20_000);

  it("renders all three source summaries and fails closed for RPT required entries", () => {
    render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getByTestId("vietnam-series-center-p-jul-17-2026")).toBeInTheDocument();
    expect(screen.getByTestId("vietnam-series-grand-loyal-jul-29-2026")).toBeInTheDocument();
    const rpt = screen.getByTestId("vietnam-series-rpt-sep-11-12-2026");
    expect(rpt).toHaveTextContent("27");
    expect(rpt).toHaveTextContent("Unavailable");
    expect(rpt).toHaveTextContent("does not explicitly split prize contribution");
    expect(rpt).not.toHaveTextContent("0 Required entries");
  });

  it("switches collision windows between released overlap and honest empty states", () => {
    render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getByText("12 days apart")).toBeInTheDocument();
    expect(screen.getByTestId("vietnam-collision-group")).toHaveTextContent("16.245.000.000 ₫");
    fireEvent.click(screen.getByRole("radio", { name: "Cùng ngày" }));
    expect(screen.getByText("No announced schedule collision in this window.")).toBeInTheDocument();
    expect(screen.queryByTestId("vietnam-collision-group")).not.toBeInTheDocument();
  });

  it("distinguishes exact templates from partial structural similarity", () => {
    render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getByTestId("vietnam-template-exact")).toHaveTextContent("Exact template");
    const partial = screen.getByTestId("vietnam-template-partial");
    expect(partial).toHaveTextContent("Partial similarity");
    expect(partial).toHaveTextContent("RPT opener");
    expect(partial).toHaveTextContent("Required entries partly unavailable");
    expect(partial).toHaveTextContent("Monetary GTD");
  });

  it("searches event rows and opens exact claim provenance", async () => {
    render(<VietnamSupplyDashboard model={model} />);
    fireEvent.change(screen.getByPlaceholderText("Event, series, venue, family..."), {
      target: { value: "CPM After Dark" },
    });
    expect(screen.getAllByText("CPM After Dark").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("CPM After Dark")[0]!);
    expect(await screen.findByTestId("vietnam-event-detail")).toBeInTheDocument();
    expect(screen.getByText(/Evidence claims \(28\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Source SHA-256").length).toBeGreaterThan(0);
    expect(screen.getAllByText("owner_provided_public_image_unverified").length).toBeGreaterThan(0);
  }, 20_000);

  it("keeps seats and tickets visibly non-monetary and missing distinct from zero", () => {
    render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getAllByText("Non-monetary").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/seats/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tickets/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Missing/).length).toBeGreaterThan(0);
    expect(screen.queryByText("0 ₫")).not.toBeInTheDocument();
  });

  it("shows corrected lineage while retaining the unverified evidence badge", () => {
    render(<VietnamSupplyDashboard model={model} />);
    expect(screen.getByText("Corrected release active")).toBeInTheDocument();
    expect(screen.getByText(/prize contribution corrected from 3.000.000 ₫ to 2.000.000 ₫/)).toBeInTheDocument();
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
    expect(screen.getByText(/Superseded release/)).toHaveTextContent(
      model.correction.supersededReleaseId,
    );
  });

  it("contains none of the forbidden forecast, probability, recommendation, or money-action copy", () => {
    const { container } = render(<VietnamSupplyDashboard model={model} />);
    expect(container.textContent).not.toMatch(
      /overlay probability|chance of overlay|optimal GTD|recommended GTD|expected entries|forecast interval|save GTD|apply GTD/i,
    );
    expect(container.querySelector("input[type=number]")).toBeNull();
  });
});

describe("VietnamMarketPulse", () => {
  it.each(["current", "corrected", "unavailable"] as const)(
    "renders the %s integrity state",
    (state) => {
      render(<VietnamMarketPulse state={state} />);
      expect(screen.getByTestId("vietnam-market-pulse")).toHaveAttribute("data-state", state);
      expect(screen.getByText(state[0]!.toUpperCase() + state.slice(1))).toBeInTheDocument();
    },
  );

  it("pauses the pulse when the page is hidden and includes reduced-motion CSS", async () => {
    const { container } = render(<VietnamMarketPulse state="corrected" />);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("vietnam-market-pulse")).toHaveAttribute("data-page-hidden", "true");
    });
    expect(container.querySelector("style")?.textContent).toContain("prefers-reduced-motion: reduce");
    expect(container.querySelector("style")?.textContent).toContain("animation-play-state: paused");
  });

  it("opens an accessible integrity detail dialog", () => {
    render(
      <VietnamMarketPulse
        state="corrected"
        releaseShortId="946a5651"
        sourceCutoff="2026-07-28T14:05:00.000Z"
        correctionId="correction-test"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View integrity detail" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Corrected release is active")).toBeInTheDocument();
    expect(screen.getByText("correction-test")).toBeInTheDocument();
  });
});

describe("VietnamSupplyContent", () => {
  it("fails closed without rendering partial values when integrity validation fails", async () => {
    render(<VietnamSupplyContent forceIntegrityError />);
    expect(await screen.findByTestId("vietnam-supply-integrity-error")).toBeInTheDocument();
    expect(screen.getByText("Vietnam supply integrity check failed")).toBeInTheDocument();
    expect(screen.queryByText("26.559.000.000 ₫")).not.toBeInTheDocument();
  });
});
