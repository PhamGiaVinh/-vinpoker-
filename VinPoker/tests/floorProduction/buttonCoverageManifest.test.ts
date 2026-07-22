import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { floorAuditViewports, floorButtonCoverageManifest } from "../../e2e/floor-button-coverage.manifest";

const coverageSpec = readFileSync(resolve(process.cwd(), "e2e/floor-button-coverage.spec.ts"), "utf8");
const canaryRunner = readFileSync(resolve(process.cwd(), "scripts/floor/floor-production-canary.mjs"), "utf8");

const requiredControls = [
  "Tạo giải", "Sửa giải", "Mở giải", "Đồng hồ", "Mở bàn", "Thêm người", "Sửa chip",
  "Chuyển", "Đóng bàn", "Bốc lại", "Phiếu", "Loại", "Cho vào lại", "Xem trước (Dự kiến)",
  "Lưu mặc định cho giải này", "Tải file (Excel/CSV)", "Chốt giải", "Huỷ", "Thử lại", "Làm mới", "Xác nhận",
];

describe("Floor button coverage manifest", () => {
  it("covers every required Floor control across the browser matrix", () => {
    for (const label of requiredControls) {
      expect(floorButtonCoverageManifest.some((entry) => entry.label.includes(label))).toBe(true);
    }
    for (const viewport of floorAuditViewports) {
      expect(floorButtonCoverageManifest.some((entry) => entry.viewport === "all" || entry.viewport === viewport)).toBe(true);
    }
  });

  it("requires owned scenarios and backend/DB evidence before destructive controls may run", () => {
    for (const entry of floorButtonCoverageManifest.filter((candidate) => (
      candidate.destructive && candidate.expectedState === "enabled" && !candidate.exclusionReason
    ))) {
      expect(entry.fixtureScenario, entry.id).toBeTruthy();
      expect(entry.expectedBackendCall, entry.id).toBeTruthy();
      expect(entry.expectedDbInvariant, entry.id).toBeTruthy();
    }
  });

  it("records payout as hidden while floorAtomicPayout is off", () => {
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "atomic-payout-off",
      expectedState: "hidden",
      exclusionReason: expect.any(String),
    }));
  });

  it("keeps official payout visible but explicitly excluded from canary clicks", () => {
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "payout-official-excluded",
      expectedState: "enabled",
      destructive: true,
      expectedBackendCall: null,
      exclusionReason: expect.stringContaining("EXCLUDED_WITH_REASON"),
    }));
  });

  it("uses real routes and real backend contracts", () => {
    expect(floorButtonCoverageManifest.some((entry) => entry.route === "/ops/tournament/:id")).toBe(false);
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "clock-start",
      route: "/ops/tournaments/:id",
      expectedBackendCall: "tournament-live-clock(start)",
    }));
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "payout-preview",
      route: "/floor",
      expectedBackendCall: "compute-payouts(mode=preview)",
    }));
    expect(floorButtonCoverageManifest.some((entry) => [
      "get_tournament_close_report",
      "payout_preview",
      "save_payout_structure",
      "load_payout_template",
    ].includes(entry.expectedBackendCall ?? ""))).toBe(false);
  });

  it("requires a reason for every hidden or source-excluded control", () => {
    for (const entry of floorButtonCoverageManifest.filter((candidate) => candidate.expectedState === "hidden")) {
      expect(entry.exclusionReason, entry.id).toBeTruthy();
    }
    for (const entry of floorButtonCoverageManifest.filter((candidate) => candidate.labelPattern)) {
      expect(() => new RegExp(entry.labelPattern, "iu"), entry.id).not.toThrow();
    }
  });

  it("keeps clock and chip action IDs distinct and removes the legacy combined adjustment", () => {
    const ids = floorButtonCoverageManifest.map((entry) => entry.id);
    expect(ids).toHaveLength(74);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "clock-start",
      "clock-pause",
      "clock-resume",
      "clock-level-next",
      "clock-level-previous",
      "clock-adjust-minus",
      "clock-adjust-plus",
      "player-chip",
      "player-chip-save",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain("clock-adjust");
    expect(
      createHash("sha256").update([...ids].sort().join("\n")).digest("hex"),
    ).toBe("1d821a12495700388993cee059a7896c6aba097cb23ce99186da7d72db98ce93");
  });

  it("waits for a visible control instead of the responsive shell's hidden first control", () => {
    expect(coverageSpec).toContain("controls.filter({ visible: true })");
    expect(coverageSpec).toContain("visibleControls.first()");
    expect(coverageSpec).not.toContain("controls.first(),");
  });

  it("snapshots realtime controls atomically and preserves the original assertion", () => {
    expect(coverageSpec).toContain("controls.evaluateAll");
    expect(coverageSpec).not.toContain("index < await controls.count()");
    expect(coverageSpec).toContain("context.close().catch(() => undefined)");
    expect(coverageSpec).toContain('"owned_tournament_selected"');
    expect(coverageSpec).toContain('"tab_selected"');
  });

  it("pins the browser audit to the locale used by manifest labels", () => {
    expect(coverageSpec).toContain('locale: "vi-VN"');
  });

  it("installs a fail-closed read-only egress guard for every inventory context", () => {
    expect(coverageSpec).toContain("installInventoryEgressGuard(context, baseURL, assignment)");
    expect(coverageSpec).toContain('serviceWorkers: "block"');
    expect(coverageSpec).toContain("context.routeWebSocket");
    expect(coverageSpec).toContain("assignment.allowedTournamentIds.includes");
    expect(coverageSpec).toContain("expectedBlockedInventoryRead");
    expect(coverageSpec).toContain("expectedBlockedEgress");
    expect(coverageSpec).toContain('route.abort("blockedbyclient")');
    expect(coverageSpec).toContain("attempted forbidden browser egress");
    expect(coverageSpec).not.toContain("request.headers()");
  });

  it("keeps known optional bootstrap reads aborted and separately classified", () => {
    for (const table of [
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
    ]) {
      expect(coverageSpec).toContain(`"${table}"`);
      expect(canaryRunner).toContain(`"${table}"`);
    }
    expect(coverageSpec).toContain('reason === "unexpected_read"');
    expect(coverageSpec).toContain("expectedBlockedEgress.push");
    expect(coverageSpec).toContain("referencedIds.every((id) => ownedIds.has(id.toLowerCase()))");
  });

  it("waits for the satellite row created by the audited click", () => {
    const addRowWait = canaryRunner.indexOf('addSatelliteRow.waitFor({ state: "visible"');
    const initialRowWait = canaryRunner.indexOf('satelliteRows.first().waitFor({ state: "visible"');
    const initialRowCount = canaryRunner.indexOf("const satelliteRowsBefore = await satelliteRows.count()");
    expect(addRowWait).toBeGreaterThan(-1);
    expect(initialRowWait).toBeGreaterThan(-1);
    expect(initialRowCount).toBeGreaterThan(addRowWait);
    expect(initialRowCount).toBeGreaterThan(initialRowWait);
    expect(canaryRunner).toContain('result("browser_payout_satellite_initial_row_visible", satelliteRowsBefore > 0)');
    expect(canaryRunner).toContain("satelliteRows.nth(satelliteRowsBefore).waitFor");
  });

  it("uses stable table-card discovery and sanitized phase diagnostics", () => {
    expect(canaryRunner).toContain("ownedOpsTableButton");
    expect(canaryRunner).toContain("ownedOpsPlayerButton");
    expect(canaryRunner).not.toContain('name: playerName, exact: true');
    expect(canaryRunner).not.toContain('name: seat.player_name, exact: true');
    expect(canaryRunner).toContain("BROWSER_PHASE_CHECKPOINT");
    expect(canaryRunner).toContain("browserPhaseErrorClass");
    expect(canaryRunner).toContain("error_class=${browserPhaseErrorClass(error)}");
  });

  it("finds an opened table sheet by its stable action controls, not its mutable display name", () => {
    expect(canaryRunner).toContain('has: page.getByRole("button", { name: "Thêm người", exact: true })');
    expect(canaryRunner).toContain('has: page.getByRole("button", { name: "Đóng bàn", exact: true })');
    expect(canaryRunner).not.toContain('hasText: new RegExp(`\\\\b${tableNumber}\\\\b`, "u")');
  });

  it("waits for the owned player action sheet before the table-lifecycle move", () => {
    const lifecycleStart = canaryRunner.indexOf("async function runBrowserTableLifecycleActions");
    const lifecycleEnd = canaryRunner.indexOf("async function runBrowserCloseTableAction", lifecycleStart);
    const lifecycleFlow = canaryRunner.slice(lifecycleStart, lifecycleEnd);
    expect(lifecycleFlow).toContain("const playerActionsDialog = page.getByRole(\"dialog\"");
    expect(lifecycleFlow).toContain('playerActionsDialog.getByRole("button", { name: "Chuyển bàn / ghế", exact: true })');
    expect(lifecycleFlow).toContain('moveAction.click({ trial: true, timeout: 15_000 })');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_action_ready")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_dialog_ready")');
    expect(lifecycleFlow).toContain('const moveTargetCard = moveDialog.getByText("Chọn bàn đích (còn ghế trống)", { exact: true }).locator("..")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_target_table_ready")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_target_table_selected")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_target_seat_ready")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_target_seat_selected")');
    expect(lifecycleFlow).toContain('browserPhaseCheckpoint("table_lifecycle", "move_confirm_ready")');
    expect(lifecycleFlow).not.toContain('page.getByRole("button", { name: /^Chuyển\\b/u }).click()');
    expect(lifecycleFlow).not.toContain('locator("xpath=');
  });

  it("scopes Retry to the table-map error card and proves the recovered owned grid", () => {
    const retryStart = canaryRunner.indexOf("async function runBrowserTableRetryAction");
    const retryEnd = canaryRunner.indexOf("async function runBrowserTvPromptActions", retryStart);
    const retryFlow = canaryRunner.slice(retryStart, retryEnd);
    expect(retryFlow).toContain('page.getByText("Không tải được sơ đồ bàn", { exact: true })');
    expect(retryFlow).toContain('retryErrorCard.getByRole("button", { name: "Thử lại", exact: true })');
    expect(retryFlow).toContain("createExactRequestLifecycleObservation(page");
    expect(retryFlow).toContain('url.pathname === "/rest/v1/tournament_tables"');
    expect(retryFlow).toContain('JSON.stringify(["select", "tournament_id"])');
    expect(retryFlow).toContain('url.searchParams.get("select") === "id,table_name,table_number,max_seats,status,table_id"');
    expect(retryFlow).toContain('url.pathname === "/functions/v1/tournament-live-draw"');
    expect(retryFlow).toContain('retryErrorTitle.waitFor({ state: "hidden", timeout: 15_000 })');
    expect(retryFlow).toContain('browserPhaseCheckpoint("table_retry", "retry_loading_started")');
    expect(retryFlow).toContain('"FLOOR_CANARY TABLE_RETRY_OBSERVATION"');
    expect(retryFlow).toContain('() => "grid"');
    expect(retryFlow).toContain('() => "error"');
    expect(retryFlow).toContain('() => "empty"');
    expect(retryFlow).toContain('page.waitForTimeout(15_000).then(() => "loading_timeout")');
    expect(retryFlow).toContain('tableRowCount === 1');
    expect(retryFlow).toContain('seatRowCount === fixture.initialSnapshot.activeSeatCount');
    expect(retryFlow).toContain('result("browser_tables_retry_refresh", uiState === "grid"');
  });

  it("waits for restore capability and scopes the action to the owned busted player row", () => {
    expect(canaryRunner).toContain('browserPhaseCheckpoint("bust_restore", "busted_player_row_ready")');
    expect(canaryRunner).toContain('browserPhaseCheckpoint("bust_restore", "restore_button_enabled")');
    expect(canaryRunner).toContain("restoreButton.click({ trial: true, timeout: 15_000 })");
    expect(canaryRunner).toContain("bustedPlayerRow.getByRole");
    expect(canaryRunner).toContain("restoreAction.click({ trial: true, timeout: 15_000 })");
    expect(canaryRunner).toContain('browserPhaseCheckpoint("bust_restore", "restore_action_ready")');
    expect(canaryRunner).toContain('observeExactPostLifecycle(restorePage, "/rest/v1/rpc/restore_busted_player_to_seat"');
    expect(canaryRunner).toContain('browserPhaseCheckpoint("bust_restore", "restore_request_seen")');
    expect(canaryRunner).toContain('browserPhaseCheckpoint("bust_restore", "restore_response_seen")');
  });

  it("uses the owner auth scope and actionable CUSTOM controls before saving a payout template", () => {
    expect(canaryRunner).toContain('const styleControl = page.getByText("Kiểu giải", { exact: true })');
    expect(canaryRunner).toContain('.getByRole("combobox")\n      .filter({ visible: true })\n      .first()');
    expect(canaryRunner).not.toContain('const styleControl = page.getByRole("combobox").first()');
    expect(canaryRunner).toContain("actorIds: [actors.owner.id]");
    expect(canaryRunner).toContain('const templateNameControl = page.getByPlaceholder("Tên mẫu", { exact: true })');
    expect(canaryRunner).toContain('templateSaveAction.click({ trial: true, timeout: 15_000 })');
    for (const checkpoint of [
      "preview_rendered",
      "style_control_ready",
      "custom_selected",
      "import_complete",
      "template_save_ready",
    ]) {
      expect(canaryRunner).toContain(`browserPhaseCheckpoint("payout_close", "${checkpoint}")`);
    }
  });

  it("classifies every enabled desktop shell control discovered on Floor", () => {
    for (const id of [
      "floor-shell-language",
      "floor-shell-notifications",
      "floor-shell-support",
      "floor-shell-operations",
      "floor-shell-qr",
      "floor-shell-sign-out",
      "floor-shell-theme",
      "floor-owned-tournament",
      "floor-shell-install-app",
    ]) {
      expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({ id, route: "/floor", role: "owner" }));
    }
  });
});
