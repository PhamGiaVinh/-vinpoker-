export type LegacyWriterInventoryRow = {
  writer: string;
  signature: string;
  sourceMigration: string;
  contextFields: readonly string[];
  lockStrategy: string;
  runtimeStatus:
    | "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED"
    | "INCOMPATIBLE_ADVISORY_LOCK_ORDER"
    | "RUNTIME_PROVEN_DEADLOCK"
    | "FIXED_BY_SHARED_TOURNAMENT_LOCK"
    | "RUNTIME_NOT_MEASURED_IDENTITY_DEPENDENCIES";
  note: string;
};

// This is a test-local manifest. It records the current-main writer surface
// without pretending that a fixture is the production body.
export const legacyWriterInventory: readonly LegacyWriterInventoryRow[] = [
  {
    writer: "floor_set_table_control_mode",
    signature: "floor_set_table_control_mode(uuid,uuid,text,bigint)",
    sourceMigration: "20270105000001_floor_table_control_mode.sql",
    contextFields: ["control_mode", "control_revision", "active_hand"],
    lockStrategy: "shared tournament advisory -> table row -> tournament row -> hashtext(tournament, table) advisory lock",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Pre-fix exact body returned 40P01 while V2 start committed; forward containment adds the shared tournament advisory before existing row locks and post-fix race is certified separately.",
  },
  {
    writer: "floor_assign_player_to_seat",
    signature: "floor_assign_player_to_seat(uuid,text,uuid,integer)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection"],
    lockStrategy: "shared tournament advisory -> tournament row -> destination table row -> seat/entry writes",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "move_player_seat",
    signature: "move_player_seat(uuid,uuid,integer,uuid,text)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "table_id", "seat_number"],
    lockStrategy: "shared tournament advisory -> entry row -> source/destination table rows -> seat/entry writes",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "close_tournament_table",
    signature: "close_tournament_table(uuid,text,text)",
    sourceMigration: "20270106000003_close_table_canonical_contract.sql",
    contextFields: ["table_status", "active_roster", "entry_linkage", "active_hand", "seat_move"],
    lockStrategy: "shared tournament advisory -> canonical table/tournament rows -> hashtext(tournament, table) advisory lock",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "The exact canonical body was preserved with a read-only authorization preflight and the shared tournament advisory before its existing row/advisory sequence; canonical regression plus close-first/start-first races pass with no 40P01.",
  },
  {
    writer: "redraw_tournament",
    signature: "redraw_tournament(uuid,text,uuid[],integer,text,boolean)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "table_status"],
    lockStrategy: "shared tournament advisory -> tournament row -> active seats -> entry rows -> redraw writes",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "floor_bust_player",
    signature: "floor_bust_player(uuid,uuid,integer,text)",
    sourceMigration: "20270105000001_floor_table_control_mode.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection", "active_hand"],
    lockStrategy: "shared tournament advisory -> tournament row -> seat -> table advisory lock -> entry/chip checks",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "restore_busted_player_to_seat",
    signature: "restore_busted_player_to_seat(uuid,uuid,integer,uuid,text)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection"],
    lockStrategy: "shared tournament advisory -> entry row -> tournament row -> destination table row -> seat/entry writes",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; an active-hand guard now fails closed before any restore write, and restore runtime/race evidence is covered by the disposable harness.",
  },
  {
    writer: "floor_update_tournament_seat_chip",
    signature: "floor_update_tournament_seat_chip(uuid,uuid,integer,integer)",
    sourceMigration: "20270105000001_floor_table_control_mode.sql",
    contextFields: ["seat_stack", "tracker_stack", "entry_stack"],
    lockStrategy: "shared tournament advisory -> tournament read -> seat row -> table advisory lock -> CAS seat write",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014. Projection parity remains a separate business contract.",
  },
  {
    writer: "floor_start_tournament_clock",
    signature: "floor_start_tournament_clock(uuid)",
    sourceMigration: "20270104000004_floor_clock_control_atomic.sql",
    contextFields: ["tournament_status", "current_level", "clock_paused_at"],
    lockStrategy: "shared tournament advisory -> tournament row -> level lookup -> tournament clock write",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "floor_control_tournament_clock",
    signature: "floor_control_tournament_clock(uuid,text,integer,text)",
    sourceMigration: "20270104000004_floor_clock_control_atomic.sql",
    contextFields: ["current_level", "clock_started_at", "clock_paused_at", "pause_accumulated"],
    lockStrategy: "shared tournament advisory -> tournament row -> level lookup -> tournament clock write",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014.",
  },
  {
    writer: "create_offline_buyin_and_seat",
    signature: "create_offline_buyin_and_seat(uuid,text,bigint,bigint,text,text)",
    sourceMigration: "20261209000000_player_entry_link.sql",
    contextFields: ["active_roster", "entry", "seat", "stack_projection"],
    lockStrategy: "shared tournament advisory -> tournament row -> table/seat selection -> seat/entry writes",
    runtimeStatus: "FIXED_BY_SHARED_TOURNAMENT_LOCK",
    note: "Exact current-main body is reproduced in the containment migration; writer-first and start-first races pass in the disposable harness with no 40P01/55P03/57014. Identity-link helper behavior is outside this lock race.",
  },
  {
    writer: "reenter_tournament_player",
    signature: "reenter_tournament_player(uuid,bigint,bigint,text)",
    sourceMigration: "20261209000000_player_entry_link.sql",
    contextFields: ["active_roster", "entry", "seat", "stack_projection"],
    lockStrategy: "shared tournament advisory -> source entry row -> tournament row -> seat/entry writes",
    runtimeStatus: "RUNTIME_NOT_MEASURED_IDENTITY_DEPENDENCIES",
    note: "Exact current-main body is reproduced in the containment migration, but the full identity-link dependency graph was intentionally not installed; runtime race remains NOT_MEASURED.",
  },
];
