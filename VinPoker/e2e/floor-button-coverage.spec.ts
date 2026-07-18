import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  entriesForViewport,
  floorAuditViewports,
  type FloorAuditRole,
} from "./floor-button-coverage.manifest";

type RouteAssignment = { route: string; role: FloorAuditRole };

function normalise(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
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
        const controls = page.locator('button:enabled, input[type="submit"]:enabled, [role="button"]:not([aria-disabled="true"])');
        const manifest = entriesForViewport(viewport).filter((entry) => entry.route === assignment.route && entry.role === assignment.role);
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

        expect(unclassified, `${assignment.role} ${assignment.route} has enabled controls without a manifest entry`).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
}
