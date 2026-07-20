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
  labelPattern?: string;
  expectedState: ExpectedControlState;
  expectedBackendCall: string | null;
  expectedDbInvariant: string | null;
  fixtureScenario?: FloorFixtureScenario;
  destructive: boolean;
  exclusionReason?: string;
}

const all = "all" as const;

export const floorButtonCoverageManifest: readonly FloorButtonCoverageEntry[] = [
  { id: "ops-tournaments-app-home", route: "/ops/tournaments", role: "owner", viewport: all, label: "App chính", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tournament-filters", route: "/ops/tournaments", role: "owner", viewport: all, label: "Bộ lọc giải", labelPattern: "^(đang chơi|hôm nay|tất cả)", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tournament-owned-row", route: "/ops/tournaments", role: "owner", viewport: all, label: "Giải TEST thuộc run", labelPattern: "^codex_floor_canary_", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: "only exact-owned tournament rows are opened", fixtureScenario: "ACCESS", destructive: false },
  { id: "tournament-create", route: "/ops/tournaments", role: "owner", viewport: all, label: "Tạo giải", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "SOURCE_NOT_WIRED: mobile form is a local draft/toast and is not a production write path." },
  { id: "tournament-edit", route: "/ops/tournaments", role: "owner", viewport: all, label: "Sửa giải", expectedState: "hidden", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "SOURCE_NOT_WIRED on mobile OpsTournaments." },
  { id: "tournament-open", route: "/ops/tournaments", role: "owner", viewport: all, label: "Mở giải", expectedState: "hidden", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "SOURCE_NOT_WIRED on mobile OpsTournaments." },
  { id: "tournament-cancel", route: "/ops/tournaments", role: "owner", viewport: all, label: "Huỷ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tournament-confirm", route: "/ops/tournaments", role: "owner", viewport: all, label: "Xác nhận", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },

  { id: "ops-cashier-owner-app-home", route: "/ops/cashier", role: "owner", viewport: all, label: "App chính", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "ops-cashier-owner-tabs", route: "/ops/cashier", role: "owner", viewport: all, label: "Cashier tabs", labelPattern: "^(hàng chờ|buy-in|sepay|staking|xác minh)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "ops-cashier-cashier-app-home", route: "/ops/cashier", role: "cashier", viewport: all, label: "App chính", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "ops-cashier-cashier-tabs", route: "/ops/cashier", role: "cashier", viewport: all, label: "Cashier tabs", labelPattern: "^(hàng chờ|buy-in|sepay|staking|xác minh)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },

  { id: "ops-tables-app-home", route: "/ops/tables", role: "floor", viewport: all, label: "App chính", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tables-search-unlabelled", route: "/ops/tables", role: "floor", viewport: all, label: "<unlabelled-enabled-control>", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "Known accessibility finding: search icon has no accessible label in current production source." },
  { id: "tables-owned-tournament", route: "/ops/tables", role: "floor", viewport: all, label: "Giải TEST thuộc run", labelPattern: "^codex_floor_canary_", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: "selection remains inside the exact-owned club", fixtureScenario: "ACCESS", destructive: false },
  { id: "tables-owned-table-card", route: "/ops/tables", role: "floor", viewport: all, label: "Bàn TEST thuộc run", labelPattern: "^[0-9]+\\s+[0-9]+/[0-9]+", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: "opened table belongs to the selected fixture", fixtureScenario: "TABLE_LIFECYCLE", destructive: false },
  { id: "tables-open", route: "/ops/tables", role: "floor", viewport: all, label: "Mở bàn", labelPattern: "^bàn$", expectedState: "enabled", expectedBackendCall: "open_tournament_table", expectedDbInvariant: "owned TABLE_LIFECYCLE table is active with unique seats", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "tables-add-player", route: "/ops/tables", role: "floor", viewport: all, label: "Thêm người", expectedState: "enabled", expectedBackendCall: "floor_assign_player_to_seat", expectedDbInvariant: "owned entry occupies exactly one owned seat", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "tables-close", route: "/ops/tables", role: "floor", viewport: all, label: "Đóng bàn", expectedState: "enabled", expectedBackendCall: "close_tournament_table", expectedDbInvariant: "no entry is busted when the exact-owned source table closes", fixtureScenario: "CLOSE_ORPHAN", destructive: true },
  { id: "tables-redraw", route: "/ops/tables", role: "floor", viewport: all, label: "Bốc lại", expectedState: "enabled", expectedBackendCall: "redraw_tournament", expectedDbInvariant: "redraw preserves each active entry once", fixtureScenario: "REDRAW", destructive: true },
  { id: "tables-redraw-preview", route: "/ops/tables", role: "floor", viewport: all, label: "Xem trước", expectedState: "enabled", expectedBackendCall: "redraw_tournament(p_dry_run=true)", expectedDbInvariant: "active seat IDs and chip total do not change", fixtureScenario: "REDRAW", destructive: false },
  { id: "tables-redraw-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận bốc lại", expectedState: "enabled", expectedBackendCall: "redraw_tournament(p_dry_run=false)", expectedDbInvariant: "active entry/seat graph stays one-to-one", fixtureScenario: "REDRAW", destructive: true },
  { id: "tables-clock", route: "/ops/tables", role: "floor", viewport: all, label: "Đồng hồ", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "tables-retry", route: "/ops/tables", role: "floor", viewport: all, label: "Thử lại", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "player-move", route: "/ops/tables", role: "floor", viewport: all, label: "Chuyển", expectedState: "enabled", expectedBackendCall: "move_player_seat", expectedDbInvariant: "entry moves atomically and keeps one active seat", fixtureScenario: "TABLE_LIFECYCLE", destructive: true },
  { id: "player-chip", route: "/ops/tables", role: "floor", viewport: all, label: "Sửa chip", expectedState: "enabled", expectedBackendCall: "tournament-live-draw(update_seats CAS)", expectedDbInvariant: "stale expected_chip_count is rejected", fixtureScenario: "CHIP_CAS", destructive: true },
  { id: "player-receipt", route: "/ops/tables", role: "floor", viewport: all, label: "Phiếu", expectedState: "enabled", expectedBackendCall: "seat_draw_receipts read", expectedDbInvariant: "read-only receipt matches the exact-owned entry", fixtureScenario: "TABLE_LIFECYCLE", destructive: false },
  { id: "player-bust", route: "/ops/tables", role: "floor", viewport: all, label: "Loại", expectedState: "enabled", expectedBackendCall: "floor_bust_player via tournament-live-draw", expectedDbInvariant: "bust is atomic and audit payload payout_applied stays false", fixtureScenario: "BUST_RESTORE", destructive: true },
  { id: "player-bust-confirm", route: "/ops/tables", role: "floor", viewport: all, label: "Xác nhận loại", expectedState: "enabled", expectedBackendCall: "floor_bust_player via tournament-live-draw", expectedDbInvariant: "only the exact-owned fixture entry is busted", fixtureScenario: "BUST_RESTORE", destructive: true },

  { id: "ops-cockpit-app-home", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "App chính", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "cockpit-back", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Giải đấu", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "cockpit-tabs", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Tab cockpit", labelPattern: "^(trạng thái|bàn|người chơi|levels|trả thưởng|lịch sử)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "clock-start", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Bắt đầu", expectedState: "enabled", expectedBackendCall: "tournament-live-clock(start)", expectedDbInvariant: "one clock transition is committed under tournament lock", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "clock-level-next", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Level tiếp", expectedState: "enabled", expectedBackendCall: "tournament-live-clock(next_level)", expectedDbInvariant: "current level changes once", fixtureScenario: "SETUP_CLOCK", destructive: true },
  { id: "clock-adjust", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "1 phút", expectedState: "disabled", expectedBackendCall: null, expectedDbInvariant: "unstarted exact-owned ACCESS fixture remains unchanged", fixtureScenario: "ACCESS", destructive: true, exclusionReason: "EXPECTED_DISABLED: adjusting time requires an active clock level; the browser route intentionally uses the unstarted ACCESS fixture. The SETUP_CLOCK API matrix separately proves adjust_time with a live level." },
  { id: "cockpit-table-map", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Sơ đồ bàn", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "player-restore", route: "/ops/tournaments/:id", role: "floor", viewport: all, label: "Cho vào lại", expectedState: "enabled", expectedBackendCall: "restore_busted_player_to_seat", expectedDbInvariant: "one empty owned seat is restored without prize payment", fixtureScenario: "BUST_RESTORE", destructive: true },

  { id: "floor-back-schedule", route: "/floor", role: "owner", viewport: all, label: "Lịch giải", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "floor-all-tournaments", route: "/floor", role: "owner", viewport: all, label: "Tất cả giải", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "floor-refresh", route: "/floor", role: "owner", viewport: all, label: "Làm mới", expectedState: "navigation-only", expectedBackendCall: "tournaments select", expectedDbInvariant: "selection remains inside exact operator scope", fixtureScenario: "ACCESS", destructive: false },
  { id: "floor-tabs", route: "/floor", role: "owner", viewport: all, label: "Floor tabs", labelPattern: "^(sơ đồ bàn|người chơi|hàng chờ|giải thưởng|blinds|màn hình tv|td ai)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "payout-style", route: "/floor", role: "owner", viewport: all, label: "Kiểu giải", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-satellite-add-row", route: "/floor", role: "owner", viewport: all, label: "Thêm dòng", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-satellite-save-disabled", route: "/floor", role: "owner", viewport: all, label: "Lưu", expectedState: "disabled", expectedBackendCall: null, expectedDbInvariant: "satellite payout remains unchanged", fixtureScenario: "PAYOUT_CLOSE", destructive: true, exclusionReason: "EXPECTED_DISABLED until a TEST satellite row is intentionally edited." },
  { id: "payout-preview", route: "/floor", role: "owner", viewport: all, label: "Xem trước (Dự kiến)", expectedState: "enabled", expectedBackendCall: "compute-payouts(mode=preview)", expectedDbInvariant: "payout runs, prizes and payments remain zero", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-save", route: "/floor", role: "owner", viewport: all, label: "Lưu mặc định cho giải này", expectedState: "enabled", expectedBackendCall: "tournaments.planned_* update", expectedDbInvariant: "only exact-owned planned settings change", fixtureScenario: "PAYOUT_CLOSE", destructive: true },
  { id: "payout-import", route: "/floor", role: "owner", viewport: "tablet-landscape", label: "Tải file (Excel/CSV)", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: "synthetic file changes browser draft only", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-template-save", route: "/floor", role: "owner", viewport: "tablet-landscape", label: "Lưu mẫu", expectedState: "enabled", expectedBackendCall: "payout_templates insert", expectedDbInvariant: "one exact run-prefixed CUSTOM template is created", fixtureScenario: "PAYOUT_CLOSE", destructive: true },
  { id: "payout-load", route: "/floor", role: "owner", viewport: "tablet-landscape", label: "Mẫu TEST thuộc run", labelPattern: "^codex_floor_canary_.*_payout_browser_template$", expectedState: "enabled", expectedBackendCall: "payout_templates select", expectedDbInvariant: "loaded template remains preview-only", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "payout-official-excluded", route: "/floor", role: "owner", viewport: all, label: "Đóng đăng ký & tạo payout", labelPattern: "^(đóng đăng ký & tạo payout|tạo payout chính thức)$", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: "registration_closed_at, payout runs, prizes and payments remain untouched", fixtureScenario: "PAYOUT_CLOSE", destructive: true, exclusionReason: "EXCLUDED_WITH_REASON: official payout and payment paths are forbidden in this canary." },
  { id: "close-report", route: "/floor", role: "owner", viewport: all, label: "Chốt giải", expectedState: "enabled", expectedBackendCall: "direct exact-owned report reads", expectedDbInvariant: "opening or cancelling the report performs no write", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-report-cancel", route: "/floor", role: "owner", viewport: "tablet-landscape", label: "Huỷ", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: "tournament stays active with no close report", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-report-continue", route: "/floor", role: "owner", viewport: "desktop-1280x900", label: "Tiếp tục", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: "confirmation step performs no write", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-report-back", route: "/floor", role: "owner", viewport: "desktop-1280x900", label: "Quay lại", expectedState: "enabled", expectedBackendCall: null, expectedDbInvariant: "confirmation step performs no write", fixtureScenario: "PAYOUT_CLOSE", destructive: false },
  { id: "close-tournament", route: "/floor", role: "owner", viewport: "desktop-1280x900", label: "Chốt giải", expectedState: "enabled", expectedBackendCall: "close_tournament", expectedDbInvariant: "one terminal transition, one zero-value report and an idempotent retry", fixtureScenario: "PAYOUT_CLOSE", destructive: true },
  { id: "atomic-payout-off", route: "/floor", role: "owner", viewport: all, label: "Chi trả giải thưởng", expectedState: "hidden", expectedBackendCall: null, expectedDbInvariant: "floorAtomicPayout remains false", fixtureScenario: "PAYOUT_CLOSE", destructive: true, exclusionReason: "EXPECTED_DISABLED: no payment, bank, SePay or staking action is permitted." },

  { id: "public-tv-fullscreen", route: "/tv/:tournamentId", role: "anonymous", viewport: all, label: "Bấm để bật toàn màn hình", labelPattern: "^(bấm để bật toàn màn hình|tap to go fullscreen)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "public-tv-skip", route: "/tv/:tournamentId", role: "anonymous", viewport: all, label: "Bỏ qua", labelPattern: "^(bỏ qua|skip)$", expectedState: "navigation-only", expectedBackendCall: null, expectedDbInvariant: null, destructive: false },
  { id: "public-tv-refresh", route: "/tv/:tournamentId", role: "anonymous", viewport: all, label: "Làm mới", expectedState: "hidden", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "No refresh control exists on the production tournament TV route; realtime owns refresh." },
  { id: "public-tv-pair", route: "/tv/pair", role: "anonymous", viewport: all, label: "Thử lại", expectedState: "hidden", expectedBackendCall: null, expectedDbInvariant: null, destructive: false, exclusionReason: "Pairing auto-retries; creating a display token is outside this exact-ID audit ledger." },
];

export function entriesForViewport(viewport: (typeof floorAuditViewports)[number]) {
  return floorButtonCoverageManifest.filter((entry) => entry.viewport === "all" || entry.viewport === viewport);
}
