import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  entriesForViewport,
  floorAuditViewports,
  type FloorButtonCoverageEntry,
  type FloorAuditRole,
} from "./floor-button-coverage.manifest";

type RouteAssignment = { route: string; role: FloorAuditRole };

function normalise(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
}

function routeMatches(template: string, route: string) {
  const pathname = route.split(/[?#]/, 1)[0] || "/";
  const escaped = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:id/g, "[^/]+");
  return new RegExp(`^${escaped}$`).test(pathname);
}

function manifestForAssignment(
  viewport: (typeof floorAuditViewports)[number],
  assignment: RouteAssignment,
) {
  return entriesForViewport(viewport).filter(
    (entry) => entry.role === assignment.role && routeMatches(entry.route, assignment.route),
  );
}

async function assertManifestCoversEnabledControls(
  root: Locator | Page,
  manifest: readonly FloorButtonCoverageEntry[],
  context: string,
) {
  const controls = root.locator('button:enabled, input[type="submit"]:enabled, [role="button"]:not([aria-disabled="true"]), [role="radio"]:not([aria-disabled="true"])');
  const unclassified: string[] = [];

  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    const label = normalise((await control.getAttribute("data-testid")) ?? (await control.innerText()));
    const known = manifest.some((entry) => {
      const expected = normalise(entry.testId ?? entry.label);
      return label === expected || label.startsWith(`${expected} `);
    });
    if (!known) unclassified.push(label || "<unlabelled-enabled-control>");
  }

  expect(unclassified, `${context} has enabled controls without a manifest entry`).toEqual([]);
}

function ownedModeFixtureTableNumber() {
  const scenarios = (process.env.FLOOR_UAT_OWNED_SCENARIOS ?? "")
    .split(",")
    .map((value) => value.trim());
  const tableNumber = process.env.FLOOR_UAT_OWNED_TABLE_NUMBER;
  if (!scenarios.includes("BUST_RESTORE") || !tableNumber || !/^\d+$/.test(tableNumber)) {
    throw new Error(
      "Refusing table-mode write without exact BUST_RESTORE ownership proof: set FLOOR_UAT_OWNED_SCENARIOS and FLOOR_UAT_OWNED_TABLE_NUMBER.",
    );
  }
  return tableNumber;
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
    return entry as RouteAssignment;
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
    test.skip(process.env.FLOOR_UAT_RUN_BROWSER !== "true", "Preview browser audit is explicitly enabled only after safe context validation.");
    const assignments = configuredAssignments();
    expect(assignments.length).toBeGreaterThan(0);

    for (const assignment of assignments) {
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
        await page.goto(new URL(assignment.route, baseURL).toString(), { waitUntil: "networkidle" });
        const manifest = manifestForAssignment(viewport, assignment);
        await assertManifestCoversEnabledControls(page, manifest, `${assignment.role} ${assignment.route}`);

        if (
          assignment.role === "floor"
          && ["/ops/tables", "/floor", "/ops/tournaments/:id"].some((route) => routeMatches(route, assignment.route))
        ) {
          const tableNumber = ownedModeFixtureTableNumber();
          const tableOpener = page.locator(
            `[data-testid="floor-table-open"][data-floor-table-number="${tableNumber}"]`,
          );
          expect(await tableOpener.count(), "owned BUST_RESTORE fixture must expose its exact table number").toBe(1);
          await tableOpener.click();

          const controlMode = page.getByTestId("floor-table-control-mode");
          await expect(controlMode).toBeVisible();
          await assertManifestCoversEnabledControls(
            controlMode,
            manifest,
            `${assignment.role} ${assignment.route} table-mode selector`,
          );

          const tracker = page.getByTestId("floor-table-control-mode-tracker");
          const manual = page.getByTestId("floor-table-control-mode-manual");
          const currentIsTracker = (await tracker.getAttribute("data-state")) === "checked";
          await (currentIsTracker ? manual : tracker).click();
          const save = page.getByTestId("floor-table-control-mode-save");
          await expect(save).toBeEnabled();
          await save.click();
          const confirm = page.getByTestId("floor-table-control-mode-confirm");
          await expect(confirm).toBeVisible();
          await assertManifestCoversEnabledControls(
            confirm.locator(".."),
            manifest,
            `${assignment.role} ${assignment.route} table-mode confirmation`,
          );
          await confirm.click();
          await expect(confirm).toBeHidden();
        }
      } finally {
        await context.close();
      }
    }
  });
}
