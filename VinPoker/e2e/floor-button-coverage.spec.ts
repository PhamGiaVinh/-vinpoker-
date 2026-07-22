import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  baselineEvidence,
  discoveryEvidence,
  type FloorControlEvidence,
} from "./floor-action-evidence";
import {
  entriesForViewport,
  floorAuditViewports,
  floorButtonCoverageManifest,
  type FloorAuditRole,
  type FloorAuditViewport,
} from "./floor-button-coverage.manifest";

type ConcreteFloorAuditViewport = Exclude<FloorAuditViewport, "all">;

const interactiveControlSelector = 'button, input[type="submit"], [role="button"], [role="combobox"], [role="tab"]';

type RouteAssignment = {
  route: string;
  manifestRoute?: string;
  role: FloorAuditRole;
  actorId?: string;
  allowedTournamentIds: string[];
  allowedRecordIds: string[];
  viewports?: ConcreteFloorAuditViewport[];
  ownedTournamentName?: string;
  tabName?: string;
};

const ownedTournamentNamePattern = /^CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8}_(ACCESS|PAYOUT_CLOSE)$/u;
const exactUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const productionSupabaseOrigin = "https://orlesggcjamwuknxwcpk.supabase.co";

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
    if (assignment.role !== "anonymous" && !exactUuidPattern.test(assignment.actorId ?? "")) {
      throw new Error("Authenticated assignments require an exact TEST actor ID");
    }
    if (
      !Array.isArray(assignment.allowedTournamentIds)
      || assignment.allowedTournamentIds.length === 0
      || assignment.allowedTournamentIds.some((id) => !exactUuidPattern.test(id))
    ) throw new Error("allowedTournamentIds must contain exact TEST tournament IDs");
    if (
      !Array.isArray(assignment.allowedRecordIds)
      || assignment.allowedRecordIds.length === 0
      || assignment.allowedRecordIds.some((id) => !exactUuidPattern.test(id))
    ) throw new Error("allowedRecordIds must contain exact TEST-owned IDs");
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

function controlEvidencePath() {
  const directory = process.env.FLOOR_UAT_STORAGE_STATE_DIR;
  const configured = process.env.FLOOR_UAT_CONTROL_EVIDENCE_PATH;
  if (!directory || !configured) throw new Error("Temporary control evidence path is required");
  const resolvedDirectory = resolve(directory);
  const resolvedFile = resolve(configured);
  if (dirname(resolvedFile) !== resolvedDirectory) {
    throw new Error("Control evidence must stay inside the temporary state directory");
  }
  return resolvedFile;
}

function appendControlEvidence(evidence: FloorControlEvidence) {
  appendFileSync(controlEvidencePath(), `${JSON.stringify(evidence)}\n`, { encoding: "utf8" });
}

function exactObjectKeys(value: unknown, expectedKeys: string[]) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()),
  );
}

const inventoryReadFilters = new Map<string, Set<string>>([
  ["blind_structure_templates", new Set(["id", "club_id"])],
  ["club_cashiers", new Set(["club_id", "user_id"])],
  ["club_floors", new Set(["club_id", "user_id"])],
  ["clubs", new Set(["id", "owner_id"])],
  ["game_tables", new Set(["id", "club_id"])],
  ["hand_actions", new Set(["id", "hand_id", "tournament_id"])],
  ["hand_players", new Set(["id", "hand_id", "player_id", "tournament_id"])],
  ["payout_templates", new Set(["id", "club_id"])],
  ["profiles", new Set(["user_id"])],
  ["seat_assignment_history", new Set(["id", "entry_id", "tournament_id"])],
  ["seat_draw_receipts", new Set(["id", "entry_id", "tournament_id"])],
  ["tournament_chip_counts", new Set(["id", "entry_id", "player_id", "tournament_id"])],
  ["tournament_close_report", new Set(["id", "tournament_id"])],
  ["tournament_eliminations", new Set(["id", "entry_id", "player_id", "tournament_id"])],
  ["tournament_entries", new Set(["id", "player_id", "tournament_id"])],
  ["tournament_hands", new Set(["id", "table_id", "tournament_id"])],
  ["tournament_levels", new Set(["id", "tournament_id"])],
  ["tournament_payout_runs", new Set(["id", "tournament_id"])],
  ["tournament_photos", new Set(["id", "tournament_id"])],
  ["tournament_prizes", new Set(["id", "tournament_id"])],
  ["tournament_registrations", new Set(["id", "player_id", "tournament_id"])],
  ["tournament_seats", new Set(["id", "entry_id", "player_id", "table_id", "tournament_id"])],
  ["tournament_tables", new Set(["id", "table_id", "tournament_id"])],
  ["tournaments", new Set(["id", "club_id"])],
]);
const inventoryPreflightPaths = new Set([
  "/functions/v1/tournament-live-draw",
  "/rest/v1/rpc/cashier_club_ids",
  "/rest/v1/rpc/dealer_control_club_ids",
  "/rest/v1/rpc/get_my_floor_operator_scope",
  "/rest/v1/rpc/get_tournament_clock",
  "/rest/v1/rpc/get_tournament_leaderboard",
  "/rest/v1/rpc/get_tournament_prizes",
  "/rest/v1/rpc/get_tournament_tables",
]);
const inventoryStaticPaths = new Set([
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/favicon.ico",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  "/robots.txt",
  "/version.json",
]);
const expectedBlockedInventoryAppPaths = new Set(["/", "/version.json"]);
const expectedBlockedInventoryRestTables = new Set([
  "booking_chats",
  "club_accountants",
  "club_chip_masters",
  "club_fnb_staff",
  "club_marketers",
  "dealer_assignments",
  "dealer_attendance",
  "dealers",
  "gto_spot_ranges",
  "notifications",
  "profiles",
  "tournament_registrations",
  "user_roles",
]);

function isAllowedInventoryAppRead(url: URL, baseURL: string, assignment: RouteAssignment) {
  if (/^\/(?:assets|fonts|sounds)\/[A-Za-z0-9_./-]+$/u.test(url.pathname)) return url.searchParams.size === 0;
  if (inventoryStaticPaths.has(url.pathname)) return url.searchParams.size === 0;
  const assigned = new URL(assignment.route, baseURL);
  return url.pathname === assigned.pathname && url.search === assigned.search;
}

function isAllowedInventorySupabaseRead(url: URL, method: string, assignment: RouteAssignment) {
  if (method === "OPTIONS") return inventoryPreflightPaths.has(url.pathname);
  if (!["GET", "HEAD"].includes(method)) return false;
  if (url.pathname === "/auth/v1/user") {
    return Boolean(assignment.actorId) && url.searchParams.size === 0;
  }
  const match = url.pathname.match(/^\/rest\/v1\/([A-Za-z0-9_]+)$/u);
  const allowedFilterColumns = match ? inventoryReadFilters.get(match[1]) : null;
  if (!allowedFilterColumns || url.searchParams.has("or") || url.searchParams.has("and")) return false;
  const ownedIds = new Set(assignment.allowedRecordIds.map((id) => id.toLowerCase()));
  return [...url.searchParams.entries()].some(([key, value]) => {
    if (!allowedFilterColumns.has(key)) return false;
    const normalized = value.toLowerCase();
    const eq = normalized.match(/^eq\.([0-9a-f-]+)$/u);
    const inList = normalized.match(/^in\.\(([0-9a-f,-]+)\)$/u);
    const ids = eq ? [eq[1]] : inList ? inList[1].split(",") : [];
    return ids.length > 0 && ids.every((id) => exactUuidPattern.test(id) && ownedIds.has(id));
  });
}

function safeRequestJson(request: import("@playwright/test").Request): Record<string, unknown> | null {
  try {
    return request.postDataJSON() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function expectedStartupRequest(
  url: URL,
  method: string,
  body: Record<string, unknown> | null,
  actorId?: string,
) {
  if (method === "POST" && url.origin === productionSupabaseOrigin && url.pathname === "/functions/v1/report-vitals") return true;
  if (["GET", "HEAD"].includes(method) && url.origin === "https://cdn.onesignal.com" && url.pathname === "/sdks/web/v16/OneSignalSDK.page.js") return true;
  if (
    actorId
    && method === "PATCH"
    && url.origin === productionSupabaseOrigin
    && url.pathname === "/rest/v1/profiles"
    && url.searchParams.get("user_id") === `eq.${actorId}`
    && exactObjectKeys(body, ["onesignal_external_user_id"])
    && body?.onesignal_external_user_id === actorId
  ) return true;
  return method === "POST"
    && url.origin === productionSupabaseOrigin
    && url.pathname === "/functions/v1/send-welcome-email"
    && [...url.searchParams.keys()].length === 0
    && (body == null || exactObjectKeys(body, []));
}

function inventoryRequestBlockReason(
  request: import("@playwright/test").Request,
  baseURL: string,
  assignment: RouteAssignment,
) {
  const url = new URL(request.url());
  const method = request.method().toUpperCase();
  const body = safeRequestJson(request);
  if (expectedStartupRequest(url, method, body, assignment.actorId)) return "expected_startup_side_effect";
  if (
    ["https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(url.origin)
    && ["GET", "HEAD", "OPTIONS"].includes(method)
  ) return null;
  if (url.origin !== new URL(baseURL).origin && url.origin !== productionSupabaseOrigin) return "external_origin";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    const allowed = url.origin === new URL(baseURL).origin
      ? method !== "OPTIONS" && isAllowedInventoryAppRead(url, baseURL, assignment)
      : isAllowedInventorySupabaseRead(url, method, assignment);
    return allowed ? null : "unexpected_read";
  }
  if (url.origin !== productionSupabaseOrigin) return "unexpected_mutation";
  if (
    method === "POST"
    && url.pathname === "/rest/v1/rpc/get_my_floor_operator_scope"
    && (body == null || exactObjectKeys(body, []))
  ) return null;
  if (
    method === "POST"
    && ["/rest/v1/rpc/dealer_control_club_ids", "/rest/v1/rpc/cashier_club_ids"].includes(url.pathname)
    && exactObjectKeys(body, ["_user_id"])
    && body?._user_id === assignment.actorId
  ) return null;
  if (
    method === "POST"
    && [
      "/rest/v1/rpc/get_tournament_clock",
      "/rest/v1/rpc/get_tournament_prizes",
      "/rest/v1/rpc/get_tournament_tables",
      "/rest/v1/rpc/get_tournament_leaderboard",
    ].includes(url.pathname)
    && exactObjectKeys(body, ["p_tournament_id"])
    && assignment.allowedTournamentIds.includes(String(body?.p_tournament_id ?? ""))
  ) return null;
  if (
    method === "POST"
    && url.pathname === "/functions/v1/tournament-live-draw"
    && exactObjectKeys(body, ["tournament_id", "action"])
    && body?.action === "get_seats"
    && assignment.allowedTournamentIds.includes(String(body.tournament_id ?? ""))
  ) return null;
  return "unexpected_mutation";
}

function expectedBlockedInventoryRead(
  request: import("@playwright/test").Request,
  baseURL: string,
  assignment: RouteAssignment,
) {
  const url = new URL(request.url());
  const method = request.method().toUpperCase();
  if (!["GET", "HEAD"].includes(method)) return false;
  const restTable = url.pathname.match(/^\/rest\/v1\/([A-Za-z0-9_]+)$/u)?.[1] ?? null;
  const knownOptionalRead = (
    url.origin === new URL(baseURL).origin
    && expectedBlockedInventoryAppPaths.has(url.pathname)
  ) || (
    url.origin === productionSupabaseOrigin
    && restTable !== null
    && expectedBlockedInventoryRestTables.has(restTable)
  );
  const ownedIds = new Set([
    ...assignment.allowedRecordIds,
    ...(assignment.actorId ? [assignment.actorId] : []),
  ].map((id) => id.toLowerCase()));
  const referencedIds = [...url.searchParams.values()].flatMap((value) => (
    value.match(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/giu) ?? []
  ));
  return knownOptionalRead
    && referencedIds.every((id) => ownedIds.has(id.toLowerCase()))
    && inventoryRequestBlockReason(request, baseURL, assignment) === "unexpected_read";
}

async function installInventoryEgressGuard(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
  assignment: RouteAssignment,
) {
  const blocked: string[] = [];
  const expectedBlockedEgress: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const reason = inventoryRequestBlockReason(request, baseURL, assignment);
    if (reason === "expected_startup_side_effect") {
      await route.abort("blockedbyclient");
      return;
    }
    if (reason === "unexpected_read" && expectedBlockedInventoryRead(request, baseURL, assignment)) {
      expectedBlockedEgress.push(`expected_blocked_optional_bootstrap_read:${request.method().toUpperCase()}:${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (reason) {
      blocked.push(`${reason}:${request.method().toUpperCase()}:${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/u, async (webSocketRoute) => {
    const webSocketUrl = new URL(webSocketRoute.url());
    const productionSupabaseHostname = new URL(productionSupabaseOrigin).hostname;
    if (webSocketUrl.protocol !== "wss:" || webSocketUrl.hostname !== productionSupabaseHostname) {
      blocked.push("external_websocket");
      await webSocketRoute.close({ code: 1008, reason: "blocked" });
      return;
    }
    webSocketRoute.connectToServer();
  });
  return { blocked, expectedBlockedEgress };
}

test.beforeAll(() => {
  const initial = floorButtonCoverageManifest
    .map((entry) => JSON.stringify(baselineEvidence(entry)))
    .join("\n");
  writeFileSync(controlEvidencePath(), `${initial}\n`, { encoding: "utf8", mode: 0o600 });
});

for (const viewport of floorAuditViewports) {
  test(`Floor button manifest covers every enabled control at ${viewport}`, async ({ browser, baseURL }) => {
    // Each viewport visits seven authenticated/public routes against the canary target.
    // Keep the audit bounded, while allowing the complete control inventory to finish.
    test.setTimeout(120_000);
    test.skip(process.env.FLOOR_UAT_RUN_BROWSER !== "true", "Preview browser audit is explicitly enabled only after safe context validation.");
    if (!baseURL) throw new Error("PLAYWRIGHT_BASE_URL is required for browser audit");
    const assignments = configuredAssignments();
    expect(assignments.length).toBeGreaterThan(0);

    for (const assignment of assignments) {
      if (assignment.viewports && !assignment.viewports.includes(viewport)) continue;
      const context = await browser.newContext({
        ...(assignment.role === "anonymous" ? {} : { storageState: storageStatePath(assignment.role) }),
        locale: "vi-VN",
        serviceWorkers: "block",
        viewport: viewport === "mobile-360x800" ? { width: 360, height: 800 }
          : viewport === "mobile-390x844" ? { width: 390, height: 844 }
            : viewport === "tablet-portrait" ? { width: 768, height: 1024 }
              : viewport === "tablet-landscape" ? { width: 1024, height: 768 }
                : viewport === "desktop-1280x900" ? { width: 1280, height: 900 }
                  : { width: 1920, height: 1080 },
      });
      const blockedEgress = await installInventoryEgressGuard(context, baseURL, assignment);

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
          if (known) {
            matchedManifestIds.add(known.id);
            appendControlEvidence(discoveryEvidence(known, viewport, enabled));
          }
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
        expect(
          blockedEgress.expectedBlockedEgress.every((entry) => entry.startsWith("expected_blocked_optional_bootstrap_read:")),
          `${assignment.role} ${manifestRoute} classified an unknown expected-blocked read`,
        ).toBe(true);
        expect(blockedEgress.blocked, `${assignment.role} ${manifestRoute} attempted forbidden browser egress`).toEqual([]);
      } finally {
        // Preserve the original timeout/assertion instead of replacing it with a
        // secondary "Test ended" error from Playwright's already-closed context.
        await context.close().catch(() => undefined);
      }
    }
  });
}
