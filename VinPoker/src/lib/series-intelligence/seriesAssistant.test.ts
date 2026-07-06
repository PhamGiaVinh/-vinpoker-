import { describe, it, expect } from "vitest";
import {
  deriveAssistantTasks,
  activeWorkflowStep,
  stepTargetAvailable,
  WORKFLOW_STEPS,
  type AssistantEvent,
  type AssistantInput,
} from "./seriesAssistant";

const NOW = new Date("2026-07-01T00:00:00Z");
const ev = (over: Partial<AssistantEvent> & { event_id: string }): AssistantEvent => ({
  name: over.name ?? over.event_id,
  date: over.date ?? null,
  hasGtd: over.hasGtd ?? true,
  event_id: over.event_id,
});
const input = (over: Partial<AssistantInput>): AssistantInput => ({
  events: [],
  isCsv: false,
  forecastEventIds: new Set(),
  resultEventIds: new Set(),
  forwardLayerAvailable: true,
  captureAvailable: true,
  now: NOW,
  ...over,
});

const UPCOMING = "2026-07-10T19:00:00Z";
const PAST = "2026-06-01T19:00:00Z";

describe("deriveAssistantTasks — empty", () => {
  it("no events → single load-data task that loads the sample", () => {
    const t = deriveAssistantTasks(input({ events: [] }));
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("load-data");
    expect(t[0].loadsSample).toBe(true);
  });
});

describe("deriveAssistantTasks — native mode", () => {
  it("upcoming event with no saved forecast → forecast-upcoming (action), soonest first", () => {
    const t = deriveAssistantTasks(
      input({
        events: [ev({ event_id: "far", date: "2026-08-01T19:00:00Z" }), ev({ event_id: "soon", name: "Main", date: UPCOMING })],
      }),
    );
    const f = t.find((x) => x.kind === "forecast-upcoming")!;
    expect(f).toBeTruthy();
    expect(f.severity).toBe("action");
    expect(f.title).toContain("Main"); // the soonest, not the far one
    expect(f.targetId).toBe("step-risk");
  });

  it("upcoming event that already has a forecast → no forecast task", () => {
    const t = deriveAssistantTasks(
      input({ events: [ev({ event_id: "soon", date: UPCOMING })], forecastEventIds: new Set(["soon"]) }),
    );
    expect(t.some((x) => x.kind === "forecast-upcoming")).toBe(false);
  });

  it("finished event with no result → confirm-result; counts extras", () => {
    const t = deriveAssistantTasks(
      input({ events: [ev({ event_id: "p1", name: "Turbo", date: PAST }), ev({ event_id: "p2", date: "2026-06-02T19:00:00Z" })] }),
    );
    const c = t.find((x) => x.kind === "confirm-result")!;
    expect(c).toBeTruthy();
    expect(c.title).toMatch(/\+1 giải khác/);
    expect(c.targetId).toBe("step-capture");
  });

  it("finished event WITH a result → no confirm task", () => {
    const t = deriveAssistantTasks(
      input({ events: [ev({ event_id: "p1", date: PAST })], resultEventIds: new Set(["p1"]) }),
    );
    expect(t.some((x) => x.kind === "confirm-result")).toBe(false);
  });

  it("GTD gap → fill-gtd warning with the count", () => {
    const t = deriveAssistantTasks(
      input({ events: [ev({ event_id: "a", date: PAST, hasGtd: false }), ev({ event_id: "b", date: PAST, hasGtd: false })], resultEventIds: new Set(["a", "b"]) }),
    );
    const g = t.find((x) => x.kind === "fill-gtd")!;
    expect(g.severity).toBe("warning");
    expect(g.title).toContain("2 giải");
  });

  it("priority: forecast-upcoming before confirm-result before fill-gtd; cap 3", () => {
    const t = deriveAssistantTasks(
      input({
        events: [
          ev({ event_id: "up", date: UPCOMING, hasGtd: false }),
          ev({ event_id: "pa", date: PAST, hasGtd: false }),
        ],
      }),
    );
    expect(t.map((x) => x.kind)).toEqual(["forecast-upcoming", "confirm-result", "fill-gtd"]);
    expect(t.length).toBeLessThanOrEqual(3);
  });

  it("all clear → weekly-review fallback (never empty)", () => {
    const t = deriveAssistantTasks(
      input({ events: [ev({ event_id: "p1", date: PAST })], resultEventIds: new Set(["p1"]) }),
    );
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("weekly-review");
  });
});

describe("deriveAssistantTasks — CSV mode is softer", () => {
  it("upcoming → info (not action), no forecast-id check needed", () => {
    const t = deriveAssistantTasks(input({ isCsv: true, events: [ev({ event_id: "s", date: UPCOMING })] }));
    const f = t.find((x) => x.kind === "forecast-upcoming")!;
    expect(f.severity).toBe("info");
  });

  it("never emits confirm-result in CSV mode (no capture data)", () => {
    const t = deriveAssistantTasks(input({ isCsv: true, events: [ev({ event_id: "p", date: PAST })] }));
    expect(t.some((x) => x.kind === "confirm-result")).toBe(false);
  });

  it("still flags GTD gaps in CSV", () => {
    const t = deriveAssistantTasks(input({ isCsv: true, events: [ev({ event_id: "p", date: PAST, hasGtd: false })] }));
    expect(t.some((x) => x.kind === "fill-gtd")).toBe(true);
  });
});

describe("deriveAssistantTasks — dates", () => {
  it("undated events never count as past or upcoming", () => {
    const t = deriveAssistantTasks(input({ events: [ev({ event_id: "x", date: null })], resultEventIds: new Set() }));
    // no upcoming, no past → only the GTD/weekly fallback logic; x has gtd → weekly-review
    expect(t.some((x) => x.kind === "forecast-upcoming" || x.kind === "confirm-result")).toBe(false);
  });

  it("unparseable date is ignored too", () => {
    const t = deriveAssistantTasks(input({ events: [ev({ event_id: "x", date: "not-a-date" })] }));
    expect(t[0].kind).toBe("weekly-review");
  });
});

describe("deriveAssistantTasks — never steer to a step the page isn't rendering", () => {
  it("forwardLayerMonteCarlo OFF → no forecast-upcoming task (that step isn't on the page)", () => {
    const t = deriveAssistantTasks(input({ forwardLayerAvailable: false, events: [ev({ event_id: "s", date: UPCOMING })] }));
    expect(t.some((x) => x.kind === "forecast-upcoming")).toBe(false);
    expect(t.some((x) => x.targetId === "step-risk")).toBe(false);
  });

  it("seriesDecisionLog OFF → no confirm-result task (⑥ isn't on the page)", () => {
    const t = deriveAssistantTasks(input({ captureAvailable: false, events: [ev({ event_id: "p", date: PAST })] }));
    expect(t.some((x) => x.kind === "confirm-result")).toBe(false);
    expect(t.some((x) => x.targetId === "step-capture")).toBe(false);
  });

  it("both forward-layer + capture OFF, past event → falls back to weekly-review (step-insights, always rendered)", () => {
    const t = deriveAssistantTasks(input({ forwardLayerAvailable: false, captureAvailable: false, events: [ev({ event_id: "p", date: PAST })] }));
    expect(t).toHaveLength(1);
    expect(t[0].targetId).toBe("step-insights");
  });
});

describe("stepTargetAvailable", () => {
  const on = { forwardLayerAvailable: true, captureAvailable: true };
  it("step-load / step-insights always available", () => {
    expect(stepTargetAvailable("step-load", { forwardLayerAvailable: false, captureAvailable: false })).toBe(true);
    expect(stepTargetAvailable("step-insights", { forwardLayerAvailable: false, captureAvailable: false })).toBe(true);
  });
  it("③④⑤ ride forwardLayerMonteCarlo", () => {
    expect(stepTargetAvailable("step-risk", on)).toBe(true);
    expect(stepTargetAvailable("step-risk", { forwardLayerAvailable: false, captureAvailable: true })).toBe(false);
    expect(stepTargetAvailable("step-schedule", { forwardLayerAvailable: false, captureAvailable: true })).toBe(false);
  });
  it("⑥ rides seriesDecisionLog; run-step (null) never clickable", () => {
    expect(stepTargetAvailable("step-capture", { forwardLayerAvailable: true, captureAvailable: false })).toBe(false);
    expect(stepTargetAvailable(null, on)).toBe(false);
  });
});

describe("activeWorkflowStep + WORKFLOW_STEPS", () => {
  it("maps top task kind → ring step", () => {
    expect(activeWorkflowStep([{ kind: "load-data" } as never])).toBe(1);
    expect(activeWorkflowStep([{ kind: "forecast-upcoming" } as never])).toBe(4);
    expect(activeWorkflowStep([{ kind: "confirm-result" } as never])).toBe(7);
    expect(activeWorkflowStep([{ kind: "fill-gtd" } as never])).toBe(5);
    expect(activeWorkflowStep([{ kind: "weekly-review" } as never])).toBe(2);
    expect(activeWorkflowStep([])).toBe(2);
  });

  it("ring has 8 steps, step 6 (run) happens off-page", () => {
    expect(WORKFLOW_STEPS).toHaveLength(8);
    expect(WORKFLOW_STEPS.find((s) => s.key === "run")!.targetId).toBeNull();
  });
});
