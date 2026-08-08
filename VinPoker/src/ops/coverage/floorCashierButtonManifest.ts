import type { OpsSideEffectClass } from "@/ops/registry/opsModuleRegistry";

export type FloorCashierCoverageDisposition =
  | "CLICKED_PASS"
  | "CLICKED_FAIL"
  | "EXPECTED_DISABLED"
  | "NAVIGATION_ONLY"
  | "EXCLUDED_WITH_REASON"
  | "BLOCKED";

export type FloorCashierButtonManifestEntry = {
  actionId: string;
  labelOrTestId: string;
  route: string;
  role: "floor" | "cashier";
  viewport: "all";
  expectedState: "ENABLED" | "DYNAMIC";
  expectedBackendCall: string;
  expectedDbInvariant: string;
  fixtureScenario: string | null;
  destructive: boolean;
  sideEffectClass: OpsSideEffectClass;
  disposition: FloorCashierCoverageDisposition;
};

const navigationActions = [
  "floor.workspace.exit",
  "floor.workspace.navigate",
  "floor.tournament.exit",
  "floor.clock.open_tables",
  "floor.tables.open_full",
  "floor.tables.open_players",
  "floor.tables.open_players_from_table",
  "floor.tables.open_clock",
  "floor.tournaments.filter",
  "floor.tournaments.open_actions",
  "floor.tournaments.create_open",
  "floor.tournaments.enter_workspace",
  "floor.tournaments.sheet_navigation",
  "floor.tournaments.select_live_status",
  "floor.tournaments.stepper",
  "floor.tables.toggle_search",
  "floor.tables.select_tournament",
  "floor.tables.open_roster",
  "floor.tables.open_seat",
  "floor.tables.open_table_dialog",
  "floor.tables.open_add_player",
  "floor.tables.open_close_table",
  "floor.tables.open_redraw",
  "floor.tables.filter_number_catalog",
  "floor.tables.select_number",
  "floor.tables.select_control_mode",
  "floor.tables.select_add_seat",
  "floor.tables.select_close_mode",
  "floor.tables.select_redraw_mode",
  "floor.tables.select_draw_mode",
  "floor.tables.back_redraw",
  "floor.player.open_info",
  "floor.player.open_move",
  "floor.player.open_chip",
  "floor.player.open_receipt",
  "floor.player.open_bust",
  "floor.player.select_move_table",
  "floor.player.select_move_seat",
  "floor.player.select_move_reason",
  "floor.player.cancel_move",
  "floor.player.close_move",
  "floor.player.chip_key",
  "floor.player.cancel_bust",
  "floor.players.filter",
  "floor.players.open_player",
  "floor.players.open_restore",
  "floor.players.close_restore",
  "floor.players.select_restore_table",
  "floor.players.select_restore_seat",
  "floor.tables.select_seat",
  "floor.screens.open_public_tv",
  "floor.screens.open_pairing",
  "cashier.navigate",
] as const;

const readActions = [
  "floor.workspace.refresh_conflict",
  "floor.tournament.refresh",
  "floor.tables.refresh",
  "floor.tables.reload_catalog",
  "floor.tables.preview_redraw",
  "cashier.refresh",
] as const;

const nonMoneyWriteActions = [
  "floor.clock.start",
  "floor.clock.pause",
  "floor.clock.resume",
  "floor.clock.previous_level",
  "floor.clock.next_level",
  "floor.clock.adjust_minus",
  "floor.clock.adjust_plus",
  "floor.tournaments.save",
  "floor.tournaments.update_live",
  "floor.tables.open_table",
  "floor.tables.cancel_open_table",
  "floor.tables.open_control_mode_confirm",
  "floor.tables.cancel_control_mode",
  "floor.tables.save_control_mode",
  "floor.tables.add_player",
] as const;

const destructiveActions = [
  "floor.tables.close_table",
  "floor.tables.confirm_redraw",
  "floor.player.move",
  "floor.player.save_chip",
  "floor.player.bust",
  "floor.players.restore",
] as const;

function entry(
  actionId: string,
  sideEffectClass: OpsSideEffectClass,
  options: {
    backend: string;
    invariant: string;
    destructive?: boolean;
    disposition: FloorCashierCoverageDisposition;
  },
): FloorCashierButtonManifestEntry {
  const role = actionId.startsWith("cashier.") ? "cashier" : "floor";
  return {
    actionId,
    labelOrTestId: `[data-ops-action="${actionId}"]`,
    route: routeForAction(actionId),
    role,
    viewport: "all",
    expectedState: "DYNAMIC",
    expectedBackendCall: options.backend,
    expectedDbInvariant: options.invariant,
    fixtureScenario: options.destructive ? fixtureForAction(actionId) : null,
    destructive: options.destructive ?? false,
    sideEffectClass,
    disposition: options.disposition,
  };
}

function routeForAction(actionId: string): string {
  if (actionId.startsWith("cashier.")) return "/ops/cashier";
  if (actionId.startsWith("floor.tournaments.")) return "/ops/floor";
  if (actionId.startsWith("floor.clock.")) return "/ops/floor/tournaments/:id/clock";
  if (actionId.startsWith("floor.players.")) return "/ops/floor/tournaments/:id/players";
  if (actionId.startsWith("floor.screens.")) return "/ops/floor/tournaments/:id/screens";
  if (actionId.startsWith("floor.player.")) return "/ops/floor/tournaments/:id/tables|players";
  if (actionId.startsWith("floor.tables.")) return "/ops/floor/tournaments/:id/tables";
  return "/ops/floor/tournaments/:id/:section";
}

function fixtureForAction(actionId: string): string {
  if (actionId === "floor.tables.confirm_redraw") return "CODEX_FLOOR_UAT_<run>_REDRAW";
  if (actionId === "floor.player.save_chip") return "CODEX_FLOOR_UAT_<run>_CHIP_CAS";
  if (actionId === "floor.player.bust" || actionId === "floor.players.restore") {
    return "CODEX_FLOOR_UAT_<run>_BUST_RESTORE";
  }
  return "CODEX_FLOOR_UAT_<run>_TABLE_LIFECYCLE";
}

export const FLOOR_CASHIER_BUTTON_MANIFEST: readonly FloorCashierButtonManifestEntry[] = [
  ...navigationActions.map((actionId) => entry(actionId, "READ", {
    backend: "none (local navigation or dialog state)",
    invariant: "No database row changes.",
    disposition: "NAVIGATION_ONLY",
  })),
  ...readActions.map((actionId) => entry(actionId, "READ", {
    backend: "caller-bound read/refetch or redraw dry_run",
    invariant: "The read must not create, update or delete rows.",
    disposition: "CLICKED_PASS",
  })),
  ...nonMoneyWriteActions.map((actionId) => entry(actionId, "NON_MONEY_WRITE", {
    backend: "fixed Floor RPC/Edge adapter; never a client table write",
    invariant: "Server confirms the write, then the client refetches canonical state.",
    disposition: "BLOCKED",
  })),
  ...destructiveActions.map((actionId) => entry(actionId, "DESTRUCTIVE", {
    backend: "fixed caller-bound Floor RPC/Edge adapter with stale/idempotency guard",
    invariant: "Only exact fixture-owned rows change and canonical state is refetched.",
    destructive: true,
    disposition: "BLOCKED",
  })),
] as const;

export const FLOOR_CASHIER_ACTION_IDS = new Set(
  FLOOR_CASHIER_BUTTON_MANIFEST.map((item) => item.actionId),
);
