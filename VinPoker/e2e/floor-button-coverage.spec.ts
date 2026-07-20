import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  entriesForViewport,
  floorAuditViewports,
  type FloorAuditRole,
  type FloorAuditViewport,
} from "./floor-button-coverage.manifest";

type ConcreteFloorAuditViewport = Exclude<FloorAuditViewport, "all">;

const interactiveControlSelector = 'button, input[type="submit"], [role="button"], [role="combobox"], [role="tab"]';

type RouteAssignment = {
  route: string;
  manifestRoute?: string;
  role: FloorAuditRole;
  viewports?: ConcreteFloorAuditViewport[];
  ownedTournamentName?: string;
  tabName?: string;
};

const ownedTournamentNamePattern = /^CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8}_(ACCESS|PAYOUT_CLOSE)$/u;

function normalise(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
}

function logAuditPhase(
  route: string,
  role: FloorAuditRole,
  viewport: ConcreteFloorAuditViewport,
  phase: string,
) {
  console.log(JSON.stringify({ route, role, viewport, auditType: "control-audit-phase", phase, status: "NAVIGATION_ONLY" }));
}

function safeRootErrorDetail(value: string) {
  return value
    .replace(/\b(?:https?|wss?):\/\/[^\s)]+/giu, "[url-redacted]")
    .replace(/\b(?:authorization|bearer|token|apikey|api[_-]?key|password)\b(?:\s*[:=]\s*|\s+)(?:bearer\s+)?\S+/giu, "[secret-redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function assertNoRootError(
  page: import("@playwright/test").Page,
  route: string,
  role: FloorAuditRole,
  viewport: ConcreteFloorAuditViewport,
  runtimeErrors: string[],
) {
  const rootErrorDetail = page.locator('[role="alert"] pre').first();
  if (await rootErrorDetail.count() === 0) return;
  const detail = safeRootErrorDetail(await rootErrorDetail.innerText());
  const runtimeDetail = runtimeErrors.at(-1) ?? "";
  throw new Error(["floor_root_error", "route=" + route, "role=" + role, "viewport=" + viewport, "detail=" + (detail || runtimeDetail || "unavailable")].join(" "));
}

function configuredAssignments(): RouteAssignment[] {
  const raw = process.env.FLOOR_UAT_ROUTE_ASSIGNMENTS;
  if (!raw) return [];
  const assignments: unknown = JSON.parse(raw);
  if (!Array.isArray(assignments)) throw new Error("FLOOR_UAT_ROUTE_ASSIGNMENTS must be a JSON array");
  return assignments.map((entry) => {
    if (!entry || typeof entry !== "object" || !("route" in entry) || !("role" in entry)) {
      throw new Error("Each Floor UAT route assignment must contain route and role");
    }
    const assignment = entry as RouteAssignment;
    if (assignment.manifestRoute != null && typeof assignment.manifestRoute !== "string") {
      throw new Error("manifestRoute must be a string when provided");
    }
    if (
      assignment.viewports != null
      && (!Array.isArray(assignment.viewports) || assignment.viewports.some((viewport) => !floorAuditViewports.includes(viewport)))
    ) throw new Error("viewports must contain only known Floor audit viewports");
    if (
      assignment.ownedTournamentName != null
      && (typeof assignment.ownedTournamentName !== "string" || !ownedTournamentNamePattern.test(assignment.ownedTournamentName))
    ) throw new Error("ownedTournamentName must identify an exact canary fixture");
    if (assignment.tabName != null && typeof assignment.tabName !== "string") {
      throw new Error("tabName must be a string when provided");
    }
    return assignment;
  });
}

function storageStatePath(role: FloorAuditRole) {
  const directory = process.env.FLOOR_UAT_STORAGE_STATE_DIR;
  if (!directory) throw new Error("FLOOR_UAT_STORAGE_STATE_DIR is required for browser audit");
  const file = resolve(directory, `${role}.json`);
  if (!existsSync(file)) throw new Error(`Missing temporary storage state for role ${role}`);
  return file;
}

for (const viewport of floorAuditViewports) {
  test(`Floor button manifest covers every enabled control at ${viewport}`, async ({ browser, baseURL }) => {
    // Each viewport visits seven authenticated/public routes against the canary target.
    // Keep the audit bounded, while allowing the complete control inventory to finish.
    test.setTimeout(120_000);
    test.skip(process.env.FLOOR_UAT_RUN_BROWSER !== "true", "Preview browser audit is explicitly enabled only after safe context validation.");
    const assignments = configuredAssignments();
    expect(assignments.length).toBeGreaterThan(0);

    for (const assignment of assignments) {
      if (assignment.viewports && !assignment.viewports.includes(viewport)) continue;
      const context = await browser.newContext({
        ...(assignment.role === "anonymous" ? {} : { storageState: storageStatePath(assignment.role) }),
        viewport: viewport === "mobile-360x800" ? { width: 360, height: 800 }
          : viewport === "mobile-390x844" ? { width: 390, height: 844 }
            : viewport === "tablet-portrait" ? { width: 768, height: 1024 }
              : viewport === "tablet-landscape" ? { width: 1024, height: 768 }
                : viewport === "desktop-1280x900" ? { width: 1280, height: 900 }
                  : { width: 1920, height: 1080 },
      });

      try {
        const page = await context.newPage();
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(safeRootErrorDetail(error.message)));
        page.on("console", (message) => {
          if (message.type() === "error") runtimeErrors.push(safeRootErrorDetail(message.text()));
        });
        // /floor owns a realtime connection, so it cannot be expected to reach networkidle.
        // The route-specific assertions below remain the readiness and correctness gate.
        const manifestRoute = assignment.manifestRoute ?? assignment.route;
        logAuditPhase(manifestRoute, assignment.role, viewport, "navigate_start");
        await page.goto(new URL(assignment.route, baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await assertNoRootError(page, manifestRoute, assignment.role, viewport, runtimeErrors);
        const controls = page.locator(interactiveControlSelector);
        // The app shell keeps a responsive menu button in the DOM with `md:hidden`.
        // Waiting on `controls.first()` therefore blocks every tablet/desktop audit
        // even when later Floor controls are visible and ready for discovery.
        const visibleControls = controls.filter({ visible: true });
        await expect(
          visibleControls.first(),
          `${assignment.role} ${assignment.manifestRoute ?? assignment.route} must render an interactive control before coverage discovery`,
        ).toBeVisible({ timeout: 30_000 });
        await assertNoRootError(page, manifestRoute, assignment.role, viewport, runtimeErrors);
        logAuditPhase(manifestRoute, assignment.role, viewport, "route_ready");
        if (assignment.ownedTournamentName) {
          logAuditPhase(manifestRoute, assignment.role, viewport, "owned_tournament_wait");
          const ownedTournament = page
            .getByRole("button", { name: assignment.ownedTournamentName, exact: true })
            .filter({ visible: true })
            .first();
          await expect(ownedTournament).toBeVisible({ timeout: 15_000 });
          await ownedTournament.click({ timeout: 15_000 });
          await expect(
            page.getByRole("button", { name: "Tất cả giải", exact: true }).filter({ visible: true }).first(),
          ).toBeVisible({ timeout: 15_000 });
          logAuditPhase(manifestRoute, assignment.role, viewport, "owned_tournament_selected");
        }
        if (assignment.tabName) {
          await page.getByRole("tab", { name: assignment.tabName, exact: true })
            .filter({ visible: true })
            .first()
            .click({ timeout: 15_000 });
          logAuditPhase(manifestRoute, assignment.role, viewport, "tab_selected");
        }
        const manifest = entriesForViewport(viewport).filter((entry) => entry.route === manifestRoute && entry.role === assignment.role);
        const unclassified: string[] = [];
        const stateMismatches: string[] = [];
        const matchedManifestIds = new Set<string>();
        // Snapshot the realtime page in one browser evaluation. Repeated locator reads
        // can chase detached controls while clock/realtime updates keep re-rendering.
        const observedControls = await controls.evaluateAll((nodes) => nodes.flatMap((node) => {
          const element = node as HTMLElement;
          const style = window.getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          const visible = style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0"
            && bounds.width > 0
            && bounds.height > 0;
          if (!visible) return [];
          const nativeDisabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
            ? element.disabled
            : false;
          return [{
            label: element.getAttribute("data-testid")
              ?? element.getAttribute("aria-label")
              ?? element.getAttribute("title")
              ?? element.innerText
              ?? element.getAttribute("value")
              ?? "",
            enabled: !nativeDisabled && element.getAttribute("aria-disabled") !== "true",
          }];
        }));
        const visibleCount = observedControls.length;
        const enabledCount = observedControls.filter((control) => control.enabled).length;

        for (const control of observedControls) {
          const { enabled } = control;
          const label = normalise(control.label);
          const observed = label || "<unlabelled-enabled-control>";
          const known = manifest.find((entry) => {
            const expected = normalise(entry.testId ?? entry.label);
            const patternMatches = entry.labelPattern ? new RegExp(entry.labelPattern, "iu").test(observed) : false;
            return observed === expected || observed.startsWith(`${expected} `) || patternMatches;
          });
          if (known) matchedManifestIds.add(known.id);
          if (enabled && !known) unclassified.push(observed);
          if (known && enabled && ["disabled", "hidden"].includes(known.expectedState)) {
            stateMismatches.push(`${known.id}:expected_${known.expectedState}_observed_enabled`);
          }
          if (known && !enabled && ["enabled", "navigation-only"].includes(known.expectedState)) {
            stateMismatches.push(`${known.id}:expected_${known.expectedState}_observed_disabled`);
          }
        }

        console.log(JSON.stringify({
          route: manifestRoute,
          role: assignment.role,
          viewport,
          visibleControls: visibleCount,
          enabledControls: enabledCount,
          auditType: "control-state-discovery",
          status: unclassified.length === 0 && stateMismatches.length === 0 ? "NAVIGATION_ONLY" : "BLOCKED",
        }));
        expect(enabledCount, `${assignment.role} ${manifestRoute} must expose at least one enabled control`).toBeGreaterThan(0);
        expect(matchedManifestIds.size, `${assignment.role} ${manifestRoute} must match at least one manifest control`).toBeGreaterThan(0);
        expect(unclassified, `${assignment.role} ${manifestRoute} has enabled controls without a manifest entry`).toEqual([]);
        expect(stateMismatches, `${assignment.role} ${manifestRoute} has manifest state mismatches`).toEqual([]);
      } finally {
        // Preserve the original timeout/assertion instead of replacing it with a
        // secondary "Test ended" error from Playwright's already-closed context.
        await context.close().catch(() => undefined);
      }
    }
  });
}
