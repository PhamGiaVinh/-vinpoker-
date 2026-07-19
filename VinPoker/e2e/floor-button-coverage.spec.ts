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
        await page.goto(new URL(assignment.route, baseURL).toString(), { waitUntil: "networkidle" });
        if (assignment.ownedTournamentName) {
          const ownedTournament = page.getByRole("button", { name: assignment.ownedTournamentName, exact: true }).first();
          await expect(ownedTournament).toBeVisible();
          await ownedTournament.click();
          await expect(page.getByRole("button", { name: "Tất cả giải", exact: true })).toBeVisible();
        }
        if (assignment.tabName) {
          await page.getByRole("tab", { name: assignment.tabName, exact: true }).click();
        }
        const controls = page.locator('button, input[type="submit"], [role="button"], [role="combobox"], [role="tab"]');
        const manifestRoute = assignment.manifestRoute ?? assignment.route;
        const manifest = entriesForViewport(viewport).filter((entry) => entry.route === manifestRoute && entry.role === assignment.role);
        const unclassified: string[] = [];
        const stateMismatches: string[] = [];
        let visibleCount = 0;
        let enabledCount = 0;
        const matchedManifestIds = new Set<string>();

        for (let index = 0; index < await controls.count(); index += 1) {
          const control = controls.nth(index);
          if (!await control.isVisible()) continue;
          visibleCount += 1;
          const enabled = await control.isEnabled() && await control.getAttribute("aria-disabled") !== "true";
          if (enabled) enabledCount += 1;
          const label = normalise(
            (await control.getAttribute("data-testid"))
              ?? (await control.getAttribute("aria-label"))
              ?? (await control.getAttribute("title"))
              ?? (await control.innerText())
              ?? (await control.getAttribute("value"))
              ?? "",
          );
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
        await context.close();
      }
    }
  });
}
