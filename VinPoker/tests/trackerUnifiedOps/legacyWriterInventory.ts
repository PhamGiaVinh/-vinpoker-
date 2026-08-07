export type LegacyWriterInventoryRow = {
  writer: string;
  signature: string;
  sourceMigration: string;
  contextFields: readonly string[];
  lockStrategy: string;
  runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED" | "INCOMPATIBLE_ADVISORY_LOCK_ORDER";
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
    lockStrategy: "table row -> tournament row -> hashtext(tournament, table) advisory lock",
    runtimeStatus: "INCOMPATIBLE_ADVISORY_LOCK_ORDER",
    note: "V2 locks the tournament advisory key before table rows; the current writer uses a different advisory key and row order.",
  },
  {
    writer: "floor_assign_player_to_seat",
    signature: "floor_assign_player_to_seat(uuid,text,uuid,integer)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection"],
    lockStrategy: "tournament row -> source/destination table rows -> seat/entry writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "move_player_seat",
    signature: "move_player_seat(uuid,uuid,integer,uuid,text)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "table_id", "seat_number"],
    lockStrategy: "entry row -> source seat -> source/destination table rows -> seat/entry writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "close_tournament_table",
    signature: "close_tournament_table(uuid,text,text)",
    sourceMigration: "20270106000003_close_table_canonical_contract.sql",
    contextFields: ["table_status", "active_roster", "entry_linkage", "active_hand", "seat_move"],
    lockStrategy: "table row -> tournament row -> hashtext(tournament, table) advisory lock",
    runtimeStatus: "INCOMPATIBLE_ADVISORY_LOCK_ORDER",
    note: "The canonical current-main body has the same lock-order/key incompatibility as mode control.",
  },
  {
    writer: "redraw_tournament",
    signature: "redraw_tournament(uuid,text,uuid[],integer,text,boolean)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "table_status"],
    lockStrategy: "tournament row -> active seats -> entry rows -> redraw writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "floor_bust_player",
    signature: "floor_bust_player(uuid,uuid,integer,text)",
    sourceMigration: "20270105000001_floor_table_control_mode.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection", "active_hand"],
    lockStrategy: "tournament row -> seat -> table advisory lock -> entry/chip checks",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "restore_busted_player_to_seat",
    signature: "restore_busted_player_to_seat(uuid,uuid,integer,uuid,text)",
    sourceMigration: "20261240000000_floor_production_hardening.sql",
    contextFields: ["active_roster", "seat", "entry", "stack_projection"],
    lockStrategy: "entry row -> tournament row -> destination table row -> seat/entry writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "floor_update_tournament_seat_chip",
    signature: "floor_update_tournament_seat_chip(uuid,uuid,integer,integer)",
    sourceMigration: "20270105000001_floor_table_control_mode.sql",
    contextFields: ["seat_stack", "tracker_stack", "entry_stack"],
    lockStrategy: "seat row -> table advisory lock -> CAS seat write",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "The current writer does not update all three projections; exact-body race proof is required before V2 rollout.",
  },
  {
    writer: "floor_start_tournament_clock",
    signature: "floor_start_tournament_clock(uuid)",
    sourceMigration: "20270104000004_floor_clock_control_atomic.sql",
    contextFields: ["tournament_status", "current_level", "clock_paused_at"],
    lockStrategy: "tournament row -> level lookup -> tournament clock write",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "floor_control_tournament_clock",
    signature: "floor_control_tournament_clock(uuid,text,integer,text)",
    sourceMigration: "20270104000004_floor_clock_control_atomic.sql",
    contextFields: ["current_level", "clock_started_at", "clock_paused_at", "pause_accumulated"],
    lockStrategy: "tournament row -> level lookup -> tournament clock write",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "create_offline_buyin_and_seat",
    signature: "create_offline_buyin_and_seat(uuid,text,bigint,bigint,text)",
    sourceMigration: "20261209000000_player_entry_link.sql",
    contextFields: ["active_roster", "entry", "seat", "stack_projection"],
    lockStrategy: "tournament row -> table/seat selection -> seat/entry writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
  {
    writer: "reenter_tournament_player",
    signature: "reenter_tournament_player(uuid,bigint,bigint,text)",
    sourceMigration: "20261209000000_player_entry_link.sql",
    contextFields: ["active_roster", "entry", "seat", "stack_projection"],
    lockStrategy: "source entry row -> tournament row -> seat/entry writes",
    runtimeStatus: "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
    note: "Exact body is not installed in the disposable baseline; no race result is claimed.",
  },
];
