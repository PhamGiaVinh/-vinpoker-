import {
  TRACKER_OPS_ROLE_CAPABILITIES,
  TRACKER_UNIFIED_OPS_CONTRACT_VERSION,
  type ListTrackerTablesResponseV2,
  type TrackerOpsFailureV2,
  type TrackerOpsRole,
  type TrackerReadinessBlockedFailureV2,
  type TrackerTableContextV2,
} from "./contracts";

export const TRACKER_UNIFIED_FIXTURE_IDS = {
  tournament: "10000000-0000-4000-8000-000000000001",
  readyTournamentTable: "20000000-0000-4000-8000-000000000001",
  activeTournamentTable: "20000000-0000-4000-8000-000000000002",
  blockedTournamentTable: "20000000-0000-4000-8000-000000000003",
  readyPhysicalTable: "30000000-0000-4000-8000-000000000001",
  activePhysicalTable: "30000000-0000-4000-8000-000000000002",
  blockedPhysicalTable: "30000000-0000-4000-8000-000000000003",
  level: "40000000-0000-4000-8000-000000000001",
  activeHand: "50000000-0000-4000-8000-000000000018",
  trackerUser: "60000000-0000-4000-8000-000000000001",
  floorUser: "60000000-0000-4000-8000-000000000002",
  chipmasterUser: "60000000-0000-4000-8000-000000000003",
} as const;

const readyRoster = [
  {
    seat_id: "70000000-0000-4000-8000-000000000001",
    entry_id: "71000000-0000-4000-8000-000000000001",
    player_id: "72000000-0000-4000-8000-000000000001",
    entry_number: 1,
    seat_number: 1,
    seat_stack: 125_000,
    tracker_stack: 125_000,
    entry_stack: 125_000,
    display_name: "Minh Anh",
    avatar_url: null,
  },
  {
    seat_id: "70000000-0000-4000-8000-000000000002",
    entry_id: "71000000-0000-4000-8000-000000000002",
    player_id: "72000000-0000-4000-8000-000000000002",
    entry_number: 2,
    seat_number: 4,
    seat_stack: 96_500,
    tracker_stack: 96_500,
    entry_stack: 96_500,
    display_name: "Bao Long",
    avatar_url: null,
  },
  {
    seat_id: "70000000-0000-4000-8000-000000000003",
    entry_id: "71000000-0000-4000-8000-000000000003",
    player_id: "72000000-0000-4000-8000-000000000003",
    entry_number: 3,
    seat_number: 7,
    seat_stack: 178_500,
    tracker_stack: 178_500,
    entry_stack: 178_500,
    display_name: "Quang Huy",
    avatar_url: null,
  },
] as const;

const level = {
  id: TRACKER_UNIFIED_FIXTURE_IDS.level,
  number: 12,
  small_blind: 1_000,
  big_blind: 2_000,
  ante: 2_000,
  is_break: false,
  clock_paused: false,
} as const;

export const TRACKER_READY_CONTEXT_FIXTURE = {
  ok: true,
  contract_version: TRACKER_UNIFIED_OPS_CONTRACT_VERSION,
  tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
  tournament_name: "VinPoker Unified Ops UAT",
  tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.readyTournamentTable,
  physical_table_id: TRACKER_UNIFIED_FIXTURE_IDS.readyPhysicalTable,
  table_name: "Sakura 01",
  table_number: 1,
  table_status: "active",
  control_mode: "tracker",
  control_revision: 3,
  context_version: "ctx_v1_fixture_ready_7af71c",
  next_hand_number: 18,
  roster: readyRoster,
  active_hand: null,
  level,
  readiness: {
    state: "ready",
    blockers: [],
    warnings: [],
  },
  chipmaster: {
    chip_set_bound: true,
    template_count: 2,
    issued_template_count: 1,
    denomination_inventory_conserved: true,
    pending_correction_count: 0,
  },
  capabilities: TRACKER_OPS_ROLE_CAPABILITIES.tracker,
} as const satisfies TrackerTableContextV2;

export const TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE = {
  ...TRACKER_READY_CONTEXT_FIXTURE,
  tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.activeTournamentTable,
  physical_table_id: TRACKER_UNIFIED_FIXTURE_IDS.activePhysicalTable,
  table_name: "Sakura 02",
  table_number: 2,
  context_version: "ctx_v1_fixture_active_c94b31",
  next_hand_number: 19,
  active_hand: {
    hand_id: TRACKER_UNIFIED_FIXTURE_IDS.activeHand,
    hand_number: 18,
    status: "in_progress",
    started_at: "2026-07-30T12:00:00.000Z",
    locked_by_user_id: TRACKER_UNIFIED_FIXTURE_IDS.trackerUser,
    locked_at: "2026-07-30T12:00:03.000Z",
    lock_version: 7,
    lock_state: "mine",
    allowed_action: "resume",
  },
  readiness: {
    state: "blocked",
    blockers: [
      {
        code: "active_hand_exists",
        severity: "blocker",
        owner: "tracker",
        message_key: "tracker.readiness.activeHandExists",
        target: {
          tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.activeTournamentTable,
          hand_id: TRACKER_UNIFIED_FIXTURE_IDS.activeHand,
        },
        remediation: "resume_hand",
      },
    ],
    warnings: [],
  },
} as const satisfies TrackerTableContextV2;

export const TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE = {
  ...TRACKER_READY_CONTEXT_FIXTURE,
  tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.blockedTournamentTable,
  physical_table_id: TRACKER_UNIFIED_FIXTURE_IDS.blockedPhysicalTable,
  table_name: "Sakura 03",
  table_number: 3,
  control_mode: "manual",
  control_revision: 1,
  context_version: "ctx_v1_fixture_floor_9d285e",
  next_hand_number: 1,
  roster: [],
  readiness: {
    state: "blocked",
    blockers: [
      {
        code: "tracker_mode_required",
        severity: "blocker",
        owner: "floor",
        message_key: "tracker.readiness.trackerModeRequired",
        target: {
          tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.blockedTournamentTable,
        },
        remediation: "open_floor_mode",
      },
      {
        code: "not_enough_players",
        severity: "blocker",
        owner: "floor",
        message_key: "tracker.readiness.notEnoughPlayers",
        target: {
          tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.blockedTournamentTable,
        },
        remediation: "open_floor_seat",
      },
    ],
    warnings: [
      {
        code: "chip_set_not_bound",
        severity: "warning",
        owner: "chipmaster",
        message_key: "tracker.readiness.chipSetNotBound",
        target: {
          tournament_table_id: TRACKER_UNIFIED_FIXTURE_IDS.blockedTournamentTable,
        },
        remediation: "open_chipmaster",
      },
    ],
  },
  chipmaster: {
    chip_set_bound: false,
    template_count: 0,
    issued_template_count: 0,
    denomination_inventory_conserved: true,
    pending_correction_count: 0,
  },
  capabilities: TRACKER_OPS_ROLE_CAPABILITIES.floor,
} as const satisfies TrackerTableContextV2;

export const TRACKER_TABLE_LIST_FIXTURE = {
  ok: true,
  contract_version: TRACKER_UNIFIED_OPS_CONTRACT_VERSION,
  tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
  tournament_name: "VinPoker Unified Ops UAT",
  tables: [
    {
      tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
      tournament_table_id: TRACKER_READY_CONTEXT_FIXTURE.tournament_table_id,
      physical_table_id: TRACKER_READY_CONTEXT_FIXTURE.physical_table_id,
      table_name: TRACKER_READY_CONTEXT_FIXTURE.table_name,
      table_number: TRACKER_READY_CONTEXT_FIXTURE.table_number,
      table_status: TRACKER_READY_CONTEXT_FIXTURE.table_status,
      control_mode: TRACKER_READY_CONTEXT_FIXTURE.control_mode,
      context_version: TRACKER_READY_CONTEXT_FIXTURE.context_version,
      player_count: TRACKER_READY_CONTEXT_FIXTURE.roster.length,
      next_hand_number: TRACKER_READY_CONTEXT_FIXTURE.next_hand_number,
      active_hand: null,
      launcher_group: "ready",
      readiness: TRACKER_READY_CONTEXT_FIXTURE.readiness,
    },
    {
      tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
      tournament_table_id: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.tournament_table_id,
      physical_table_id: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.physical_table_id,
      table_name: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.table_name,
      table_number: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.table_number,
      table_status: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.table_status,
      control_mode: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.control_mode,
      context_version: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.context_version,
      player_count: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.roster.length,
      next_hand_number: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.next_hand_number,
      active_hand: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.active_hand,
      launcher_group: "active_hand",
      readiness: TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.readiness,
    },
    {
      tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
      tournament_table_id: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.tournament_table_id,
      physical_table_id: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.physical_table_id,
      table_name: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.table_name,
      table_number: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.table_number,
      table_status: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.table_status,
      control_mode: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.control_mode,
      context_version: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.context_version,
      player_count: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.roster.length,
      next_hand_number: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.next_hand_number,
      active_hand: null,
      launcher_group: "needs_floor",
      readiness: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.readiness,
    },
  ],
} as const satisfies ListTrackerTablesResponseV2;

export const TRACKER_ROLE_FIXTURES = {
  tracker: {
    user_id: TRACKER_UNIFIED_FIXTURE_IDS.trackerUser,
    capabilities: TRACKER_OPS_ROLE_CAPABILITIES.tracker,
  },
  floor: {
    user_id: TRACKER_UNIFIED_FIXTURE_IDS.floorUser,
    capabilities: TRACKER_OPS_ROLE_CAPABILITIES.floor,
  },
  chipmaster: {
    user_id: TRACKER_UNIFIED_FIXTURE_IDS.chipmasterUser,
    capabilities: TRACKER_OPS_ROLE_CAPABILITIES.chipmaster,
  },
} as const satisfies Partial<
  Record<TrackerOpsRole, { user_id: string; capabilities: readonly string[] }>
>;

export const TRACKER_IDENTITY_ERROR_FIXTURES = {
  notFound: {
    ok: false,
    error: "table_not_found",
    message_key: "tracker.errors.tableNotFound",
  },
  ambiguous: {
    ok: false,
    error: "ambiguous_table_identity",
    message_key: "tracker.errors.ambiguousTableIdentity",
  },
} as const satisfies Record<string, TrackerOpsFailureV2>;

export const TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES = {
  manualMode: {
    ok: false,
    error: "readiness_blocked",
    message_key: "tracker.errors.readinessBlocked",
    context_version: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.context_version,
    readiness: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.readiness,
  },
  breakActive: {
    ok: false,
    error: "readiness_blocked",
    message_key: "tracker.errors.readinessBlocked",
    context_version: "ctx_v1_fixture_break_56c112",
    readiness: {
      state: "blocked",
      blockers: [
        {
          code: "tournament_break_active",
          severity: "blocker",
          owner: "floor",
          message_key: "tracker.readiness.tournamentBreakActive",
          target: {
            tournament_table_id:
              TRACKER_UNIFIED_FIXTURE_IDS.readyTournamentTable,
          },
          remediation: "open_floor_level",
        },
      ],
      warnings: [],
    },
  },
} as const satisfies Record<string, TrackerReadinessBlockedFailureV2>;
