export const floorAuditViewports = [
  "mobile-360x800",
  "mobile-390x844",
  "tablet-portrait",
  "tablet-landscape",
  "desktop-1280x900",
  "desktop-1920",
] as const;

export type FloorAuditRole = "anonymous" | "owner" | "cashier" | "floor";
export type FloorAuditViewport = (typeof floorAuditViewports)[number] | "all";
export type ExpectedControlState = "enabled" | "disabled" | "navigation-only" | "hidden";
export type FloorFixtureScenario =
  | "ACCESS"
  | "SETUP_CLOCK"
  | "TABLE_LIFECYCLE"
  | "CLOSE_ORPHAN"
  | "REDRAW"
  | "CHIP_CAS"
  | "BUST_RESTORE"
  | "PAYOUT_CLOSE"
  | "CONCURRENCY";

export type FloorAuditResult =
  | "CLICKED_PASS"
  | "CLICKED_FAIL"
  | "EXPECTED_DISABLED"
  | "NAVIGATION_ONLY"
  | "EXCLUDED_WITH_REASON"
  | "BLOCKED";

export interface FloorButtonCoverageEntry {
  id: string;
  route: string;
  role: FloorAuditRole;
  viewport: FloorAuditViewport;
  label: string;
  testId?: string;
  expectedState: ExpectedControlState;
  expectedBackendCall: string | null;
  expectedDbInvariant: string | null;
  fixtureScenario?: FloorFixtureScenario;
  destructive: boolean;
  exclusionReason?: string;
}

const all = "all" as const;

export const floorButtonCoverageManifest: readonly FloorButtonCoverageEntry[] = [
  { id: "tables-open-detail", route: "/ops/tables", role: "floor", viewport: all, label: "Mở Bàn", testId: "floor-table-open", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "ACCESS", destructive: false },
  { id: "tables-control-mode-manual", route: "/ops/tables", role: "floor", viewport: all, label: "Manual Floor", testId: "floor-table-control-mode-manual", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "tables-control-mode-tracker", route: "/ops/tables", role: "floor", viewport: all, label: "Live Tracker", testId: "floor-table-control-mode-tracker", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "tables-control-mode-save", route: "/ops/tables", role: "floor", viewport: all, label: "Lưu chế độ bàn", testId: "floor-table-control-mode-save", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "tables-control-mode-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận đổi chế độ", testId: "floor-table-control-mode-confirm", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "tables-control-mode-cancel", route: "/ops/tables", role: "floor", viewport: all, label: "Huỷ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "tables-chip-tracker-disabled", route: "/ops/tables", role: "floor", viewport: all, label: "Sửa chip", expectedState: "disabled", expectedBackendCall: null, expectedDbInvariant: "Live Tracker stack remains owned by tracker settlement", fixtureScenario: "CHIP_CAS", destructive: true, exclusionReason: "Tracker tables do not expose Floor chip editing." },
  { id: "floor-open-detail", route: "/floor", role: "floor", viewport: all, label: "Mở Bàn", testId: "floor-table-open", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "ACCESS", destructive: false },
  { id: "floor-control-mode-manual", route: "/floor", role: "floor", viewport: all, label: "Manual Floor", testId: "floor-table-control-mode-manual", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "floor-control-mode-tracker", route: "/floor", role: "floor", viewport: all, label: "Live Tracker", testId: "floor-table-control-mode-tracker", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "floor-control-mode-save", route: "/floor", role: "floor", viewport: all, label: "Lưu chế độ bàn", testId: "floor-table-control-mode-save", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "floor-control-mode-confirm", route: "/floor", role: "floor", viewport: all, label: "Xác nhận đổi chế độ", testId: "floor-table-control-mode-confirm", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "floor-control-mode-cancel", route: "/floor", role: "floor", viewport: all, label: "Huỷ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "tournament-create", route: "/ops/tournaments", role: "owner", viewport: all, label: "Tạo giải", expectedState: "enabled", expectedBackendCall: "create_tournament", expectedDbInvariant: "owned SETUP_CLOCK tournament is created once", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "tournament-edit", route: "/ops/tournaments", role: "owner", viewport: all, label: "Sửa giải", expectedState: "enabled", expectedBackendCall: "update_tournament", expectedDbInvariant: "only owned tournament fields change", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "tournament-open", route: "/ops/tournaments", role: "owner", viewport: all, label: "Mở giải", expectedState: "enabled", expectedBackendCall: "open_tournament", expectedDbInvariant: "owned tournament state becomes open", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "tournament-cancel", route: "/ops/tournaments", role: "owner", viewport: all, label: "Huỷ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tournament-confirm", route: "/ops/tournaments", role: "owner", viewport: all, label: "Xác nhận", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tables-open", route: "/ops/tables", role: "floor", viewport: all, label: "Mở bàn", expectedState: "enabled", expectedBackendCall: "open_tournament_table", expectedDbInvariant: "owned TABLE_LIFECYCLE table is active with unique seats", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "tables-add-player", route: "/ops/tables", role: "floor", viewport: all, label: "Thêm người", expectedState: "enabled", expectedBackendCall: "floor_assign_player_to_seat", expectedDbInvariant: "owned entry occupies exactly one owned seat", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "tables-close", route: "/ops/tables", role: "floor", viewport: all, label: "Đóng bàn", expectedState: "enabled", expectedBackendCall: "close_tournament_table", expectedDbInvariant: "no orphan active seat remains", fixtureScenario: "CLOSE_ORPHAN", destructive: true },
  { id: "tables-redraw", route: "/ops/tables", role: "floor", viewport: all, label: "Bốc lại", expectedState: "enabled", expectedBackendCall: "redraw_tournament", expectedDbInvariant: "redraw plan preserves each active entry once", fixtureScenario: "REDRAW", destructive: true },
  { id: "tables-redraw-preview", route: "/ops/tables", role: "floor", viewport: all, label: "Xem trước bốc lại", expectedState: "enabled", expectedBackendCall: "redraw_tournament(dry_run=true)", expectedDbInvariant: "no rows change during preview", fixtureScenario: "REDRAW", destructive: false },
  { id: "tables-redraw-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận bốc lại", expectedState: "enabled", expectedBackendCall: "redraw_tournament(dry_run=false)", expectedDbInvariant: "active entry/seat graph stays one-to-one", fixtureScenario: "REDRAW", destructive: true },
  { id: "tables-clock", route: "/ops/tables", role: "floor", viewport: all, label: "Đồng hồ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tables-retry", route: "/ops/tables", role: "floor", viewport: all, label: "Thử lại", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "player-move", route: "/ops/tables", role: "floor", viewport: all, label: "Chuyển ghế", expectedState: "enabled", expectedBackendCall: "move_player_seat", expectedDbInvariant: "entry moves atomically and stale seat graphs fail", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "player-chip", route: "/ops/tables", role: "floor", viewport: all, label: "Sửa chip", expectedState: "enabled", expectedBackendCall: "tournament-live-draw", expectedDbInvariant: "chip CAS rejects stale expected_chip_count", fixtureScenario: "CHIP_CAS", destructive: true },
  { id: "player-receipt", route: "/ops/tables", role: "floor", viewport: all, label: "Phiếu", expectedState: "enabled", expectedBackendCall: "get_seat_receipt", expectedDbInvariant: "read-only receipt matches owned entry", fixtureScenario: "TABLE_LIFECYCLE", destructive: false },
  { id: "player-bust", route: "/ops/tables", role: "floor", viewport: all, label: "Loại", expectedState: "enabled", expectedBackendCall: "floor_bust_player", expectedDbInvariant: "bust is atomic and payout_applied remains false", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "player-bust-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận loại", expectedState: "enabled", expectedBackendCall: "floor_bust_player", expectedDbInvariant: "only the owned fixture entry is busted", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "player-manual-bust-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận loại còn chip", testId: "floor-manual-bust-confirm", expectedState: "enabled", expectedBackendCall: "floor_bust_player", expectedDbInvariant: "Manual bust keeps historical seat chips, audit records the override, and no payout occurs", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "cockpit-open-detail", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Mở Bàn", testId: "floor-table-open", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "ACCESS", destructive: false },
  { id: "cockpit-control-mode-manual", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Manual Floor", testId: "floor-table-control-mode-manual", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "cockpit-control-mode-tracker", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Live Tracker", testId: "floor-table-control-mode-tracker", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "cockpit-control-mode-save", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Lưu chế độ bàn", testId: "floor-table-control-mode-save", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "cockpit-control-mode-confirm", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Xác nhận đổi chế độ", testId: "floor-table-control-mode-confirm", expectedState: "enabled", expectedBackendCall: "floor_set_table_control_mode", expectedDbInvariant: "owned table mode changes by revision and is audited without payout", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "cockpit-control-mode-cancel", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Huỷ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "BUST_RESTORE", destructive: false },
  { id: "player-restore", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Khôi phục", expectedState: "enabled", expectedBackendCall: "restore_busted_player_to_seat", expectedDbInvariant: "restore rejects paid prizes and restores an owned empty seat", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "clock-start", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Bắt đầu đồng hồ", expectedState: "enabled", expectedBackendCall: "tournament-live-clock", expectedDbInvariant: "one clock-start transition is recorded under tournament lock", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "payout-preview", route: "/ops/tournaments/:id", role: "owner", viewport: all, label: "Xem trước trả thưởng", expectedState: "enabled", expectedBackendCall: "payout_preview", expectedDbInvariant: "preview performs no prize payment", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-save", route: "/ops/tournaments/:id", role: "owner", viewport: all, label: "Lưu cơ cấu", expectedState: "enabled", expectedBackendCall: "save_payout_structure", expectedDbInvariant: "owned fixture payout structure is revalidated", fixtureScenario: "PAYOUT_CLOSE", destructive: true },
  { id: "payout-load", route: "/ops/tournaments/:id", role: "owner", viewport: all, label: "Tải mẫu", expectedState: "enabled", expectedBackendCall: "load_payout_template", expectedDbInvariant: "loaded template remains preview-only", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-report", route: "/ops/tournaments/:id", role: "owner", viewport: all, label: "Close Report", expectedState: "enabled", expectedBackendCall: "get_tournament_close_report", expectedDbInvariant: "report is derived from the owned fixture only", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-tournament", route: "/ops/tournaments/:id", role: "owner", viewport: all, label: "Đóng giải", expectedState: "enabled", expectedBackendCall: "close_tournament", expectedDbInvariant: "close rejects inconsistent entries and records one terminal transition", fixtureScenario: "PAYOUT_CLOSE", destructive: true },
  { id: "public-tv-refresh", route: "/tv/:display", role: "anonymous", viewport: all, label: "Làm mới", expectedState: "navigation-only", expectedBackendCall: "get_tv_display_state", expectedDbInvariant: null, destructive: false },
  { id: "public-tv-pair", route: "/tv/pair", role: "anonymous", viewport: all, label: "Thử lại", expectedState: "navigation-only", expectedBackendCall: "tv_pair_begin", expectedDbInvariant: null, destructive: false },
  { id: "atomic-payout-off", route: "/ops/tournament/:id", role: "owner", viewport: all, label: "Chi trả giải thưởng", expectedState: "disabled", expectedBackendCall: null, expectedDbInvariant: "floorAtomicPayout remains false", fixtureScenario: "PAYOUT_CLOSE", destructive: true, exclusionReason: "No real payment, bank, SePay, or staking action is permitted in the audit." },
];

export function entriesForViewport(viewport: (typeof floorAuditViewports)[number]) {
  return floorButtonCoverageManifest.filter((entry) => entry.viewport === "all" || entry.viewport === viewport);
}
