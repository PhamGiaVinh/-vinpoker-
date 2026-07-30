import {
  TRACKER_CONTEXT_HASH_VERSION,
  type TrackerContextHashInputV1,
} from "./contracts";

export const TRACKER_CONTEXT_HASH_VECTOR_V1_INPUT = {
  context_hash_version: TRACKER_CONTEXT_HASH_VERSION,
  tournament: {
    id: "10000000-0000-4000-8000-000000000001",
    status: "running",
  },
  table: {
    tournament_table_id: "20000000-0000-4000-8000-000000000001",
    physical_table_id: "30000000-0000-4000-8000-000000000001",
    status: "active",
    control_mode: "tracker",
    control_revision: 3,
  },
  roster: [
    {
      seat_id: "70000000-0000-4000-8000-000000000001",
      entry_id: "71000000-0000-4000-8000-000000000001",
      player_id: "72000000-0000-4000-8000-000000000001",
      entry_number: 1,
      seat_number: 1,
      seat_stack: 125_000,
      tracker_stack: 125_000,
      entry_stack: 125_000,
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
    },
  ],
  active_hand: {
    hand_id: "50000000-0000-4000-8000-000000000018",
    hand_number: 18,
    status: "in_progress",
    locked_by_user_id: "60000000-0000-4000-8000-000000000001",
    lock_version: 7,
  },
  next_hand_number: 18,
  level: {
    id: "40000000-0000-4000-8000-000000000001",
    number: 12,
    small_blind: 1_000,
    big_blind: 2_000,
    ante: 2_000,
    is_break: false,
    clock_paused: false,
  },
} as const satisfies TrackerContextHashInputV1;

// Keys are recursively lexicographic. Roster rows are sorted by seat_number,
// then seat_id. The browser treats the resulting SHA-256 token as opaque.
export const TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON =
  "{\"active_hand\":{\"hand_id\":\"50000000-0000-4000-8000-000000000018\",\"hand_number\":18,\"lock_version\":7,\"locked_by_user_id\":\"60000000-0000-4000-8000-000000000001\",\"status\":\"in_progress\"},\"context_hash_version\":\"tracker-context-v1\",\"level\":{\"ante\":2000,\"big_blind\":2000,\"clock_paused\":false,\"id\":\"40000000-0000-4000-8000-000000000001\",\"is_break\":false,\"number\":12,\"small_blind\":1000},\"next_hand_number\":18,\"roster\":[{\"entry_id\":\"71000000-0000-4000-8000-000000000001\",\"entry_number\":1,\"entry_stack\":125000,\"player_id\":\"72000000-0000-4000-8000-000000000001\",\"seat_id\":\"70000000-0000-4000-8000-000000000001\",\"seat_number\":1,\"seat_stack\":125000,\"tracker_stack\":125000},{\"entry_id\":\"71000000-0000-4000-8000-000000000002\",\"entry_number\":2,\"entry_stack\":96500,\"player_id\":\"72000000-0000-4000-8000-000000000002\",\"seat_id\":\"70000000-0000-4000-8000-000000000002\",\"seat_number\":4,\"seat_stack\":96500,\"tracker_stack\":96500}],\"table\":{\"control_mode\":\"tracker\",\"control_revision\":3,\"physical_table_id\":\"30000000-0000-4000-8000-000000000001\",\"status\":\"active\",\"tournament_table_id\":\"20000000-0000-4000-8000-000000000001\"},\"tournament\":{\"id\":\"10000000-0000-4000-8000-000000000001\",\"status\":\"running\"}}";

export const TRACKER_CONTEXT_HASH_VECTOR_V1_SHA256 =
  "140bd6b013d0417a9d0f2d3f7093b8a3b2033c5b6d1b7a1f0d7dd440b9287e75";
