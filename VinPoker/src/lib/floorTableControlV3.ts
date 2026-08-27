import { FEATURES } from "@/lib/featureFlags";

/**
 * Browser contract for Floor Table Control V3.
 *
 * The database contract is deliberately newer than generated Supabase types,
 * so this module is the only place allowed to cross that temporary boundary.
 * It has a fixed RPC allow-list, validates every response, and refuses every
 * call while the V3 source flag is OFF.  It must never be used as a generic
 * `rpc(name, args)` escape hatch.
 */
export type FloorTableControlV3RpcName =
  | "get_club_table_inventory"
  | "get_floor_seatable_entries"
  | "validate_tracker_table_writer_context_v3"
  | "floor_open_tournament_table_v3"
  | "operator_open_club_tables_v2"
  | "operator_close_club_table_v2"
  | "floor_assign_entry_to_seat"
  | "floor_set_table_control_mode_v3"
  | "move_player_seat_v2"
  | "close_tournament_table_v3"
  | "floor_break_table_v3"
  | "floor_bust_player_v3"
  | "floor_restore_busted_player_to_seat_v3";

export type FloorTableControlV3Rpc = (
  name: FloorTableControlV3RpcName,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown | null }>;

export type FloorTableControlV3Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FloorTableInventoryAvailability =
  | "available"
  | "in_use"
  | "maintenance"
  | "disabled"
  | "retired"
  | "preflight_required";

export type FloorTableInventoryItem = {
  gameTableId: string;
  tableNumber: number;
  tableName: string | null;
  operationalStatus: "available" | "maintenance" | "disabled" | "retired" | null;
  availabilityStatus: FloorTableInventoryAvailability;
  tableSessionId: string | null;
  sessionType: "tournament" | "cash" | "vip" | null;
  controlMode: "manual" | "tracker" | null;
  controlEpoch: number | null;
  revision: number | null;
  tournamentId: string | null;
  tournamentTableId: string | null;
  tournamentTableStatus: string | null;
  activeDealerAssignmentId: string | null;
};

export type FloorSeatableEntry = {
  entryId: string;
  playerId: string;
  entryNo: number;
  displayName: string;
  currentStack: number;
  registrationId: string;
};

type JsonRecord = Record<string, unknown>;
type MutationResult = JsonRecord & { ok: boolean; error?: string };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  return value == null ? null : typeof value === "string" ? value : undefined;
}

function nullableInteger(value: unknown): number | null | undefined {
  return value == null
    ? null
    : typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
}

function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return "V3_RPC_FAILED";
}

function parseInventoryItem(value: unknown): FloorTableControlV3Result<FloorTableInventoryItem> {
  if (!isRecord(value)) return { ok: false, error: "V3_INVENTORY_ROW_MALFORMED" };

  const gameTableId = value.game_table_id;
  const tableNumber = value.table_number;
  const tableName = nullableString(value.table_name);
  const operationalStatus = nullableString(value.operational_status);
  const availabilityStatus = value.availability_status;
  const tableSessionId = nullableString(value.table_session_id);
  const sessionType = nullableString(value.session_type);
  const controlMode = nullableString(value.control_mode);
  const controlEpoch = nullableInteger(value.control_epoch);
  const revision = nullableInteger(value.revision);
  const tournamentId = nullableString(value.tournament_id);
  const tournamentTableId = nullableString(value.tournament_table_id);
  const tournamentTableStatus = nullableString(value.tournament_table_status);
  const activeDealerAssignmentId = nullableString(value.active_dealer_assignment_id);

  if (
    typeof gameTableId !== "string"
    || !gameTableId
    || typeof tableNumber !== "number"
    || !Number.isInteger(tableNumber)
    || tableNumber < 1
    || tableNumber > 100
    || tableName === undefined
    || ![null, "available", "maintenance", "disabled", "retired"].includes(operationalStatus)
    || typeof availabilityStatus !== "string"
    || !["available", "in_use", "maintenance", "disabled", "retired", "preflight_required"].includes(availabilityStatus)
    || tableSessionId === undefined
    || ![null, "tournament", "cash", "vip"].includes(sessionType)
    || ![null, "manual", "tracker"].includes(controlMode)
    || controlEpoch === undefined
    || revision === undefined
    || tournamentId === undefined
    || tournamentTableId === undefined
    || tournamentTableStatus === undefined
    || activeDealerAssignmentId === undefined
  ) {
    return { ok: false, error: "V3_INVENTORY_ROW_MALFORMED" };
  }

  if (
    (availabilityStatus === "in_use" && (!tableSessionId || !sessionType || controlEpoch == null || revision == null))
    || (sessionType === "tournament" && (!tournamentId || !tournamentTableId))
  ) {
    return { ok: false, error: "V3_INVENTORY_ROW_INCONSISTENT" };
  }

  return {
    ok: true,
    data: {
      gameTableId,
      tableNumber,
      tableName,
      operationalStatus: operationalStatus as FloorTableInventoryItem["operationalStatus"],
      availabilityStatus: availabilityStatus as FloorTableInventoryAvailability,
      tableSessionId,
      sessionType: sessionType as FloorTableInventoryItem["sessionType"],
      controlMode: controlMode as FloorTableInventoryItem["controlMode"],
      controlEpoch,
      revision,
      tournamentId,
      tournamentTableId,
      tournamentTableStatus,
      activeDealerAssignmentId,
    },
  };
}

function parseSeatableEntry(value: unknown): FloorTableControlV3Result<FloorSeatableEntry> {
  if (!isRecord(value)) return { ok: false, error: "V3_SEATABLE_ENTRY_MALFORMED" };
  const entryId = value.entry_id;
  const playerId = value.player_id;
  const entryNo = value.entry_no;
  const displayName = value.display_name;
  const currentStack = value.current_stack;
  const registrationId = value.registration_id;
  if (
    typeof entryId !== "string" || !entryId
    || typeof playerId !== "string" || !playerId
    || typeof entryNo !== "number" || !Number.isSafeInteger(entryNo)
    || typeof displayName !== "string" || !displayName.trim()
    || typeof currentStack !== "number" || !Number.isSafeInteger(currentStack)
    || typeof registrationId !== "string" || !registrationId
  ) {
    return { ok: false, error: "V3_SEATABLE_ENTRY_MALFORMED" };
  }
  return { ok: true, data: { entryId, playerId, entryNo, displayName, currentStack, registrationId } };
}

function parseMutation(value: unknown): FloorTableControlV3Result<MutationResult> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { ok: false, error: "V3_MUTATION_RESPONSE_MALFORMED" };
  }
  if (!value.ok) {
    return { ok: false, error: typeof value.error === "string" && value.error ? value.error : "V3_MUTATION_REJECTED" };
  }
  return { ok: true, data: value as MutationResult };
}

function mutationFromResponse(response: FloorTableControlV3Result<unknown>): FloorTableControlV3Result<MutationResult> {
  return response.ok === false
    ? { ok: false, error: response.error }
    : parseMutation(response.data);
}

export function createFloorTableControlV3Client(
  rpc: FloorTableControlV3Rpc,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? FEATURES.floorTableControlV3;

  const call = async (
    name: FloorTableControlV3RpcName,
    args: Record<string, unknown>,
  ): Promise<FloorTableControlV3Result<unknown>> => {
    if (!enabled) return { ok: false, error: "FLOOR_TABLE_CONTROL_V3_DISABLED" };
    const response = await rpc(name, args);
    if (response.error) return { ok: false, error: errorMessage(response.error) };
    return { ok: true, data: response.data };
  };

  return {
    enabled,

    async getClubTableInventory(clubId: string): Promise<FloorTableControlV3Result<FloorTableInventoryItem[]>> {
      const response = await call("get_club_table_inventory", { p_club_id: clubId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_INVENTORY_RESPONSE_MALFORMED" };
      const inventory: FloorTableInventoryItem[] = [];
      const tableIds = new Set<string>();
      const tableNumbers = new Set<number>();
      for (const row of response.data) {
        const parsed = parseInventoryItem(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (tableIds.has(parsed.data.gameTableId) || tableNumbers.has(parsed.data.tableNumber)) {
          return { ok: false, error: "V3_INVENTORY_DUPLICATE_PHYSICAL_TABLE" };
        }
        tableIds.add(parsed.data.gameTableId);
        tableNumbers.add(parsed.data.tableNumber);
        inventory.push(parsed.data);
      }
      return { ok: true, data: inventory };
    },

    async getSeatableEntries(tournamentId: string): Promise<FloorTableControlV3Result<FloorSeatableEntry[]>> {
      const response = await call("get_floor_seatable_entries", { p_tournament_id: tournamentId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_SEATABLE_ENTRIES_RESPONSE_MALFORMED" };
      const entries: FloorSeatableEntry[] = [];
      const ids = new Set<string>();
      for (const row of response.data) {
        const parsed = parseSeatableEntry(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (ids.has(parsed.data.entryId)) return { ok: false, error: "V3_SEATABLE_ENTRY_DUPLICATE" };
        ids.add(parsed.data.entryId);
        entries.push(parsed.data);
      }
      return { ok: true, data: entries };
    },

    openTournamentTable: (args: { tournamentId: string; gameTableId: string; controlMode: "manual" | "tracker"; requestId: string }) =>
      call("floor_open_tournament_table_v3", {
        p_tournament_id: args.tournamentId,
        p_game_table_id: args.gameTableId,
        p_control_mode: args.controlMode,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    openClubTables: (args: { gameTableIds: string[]; sessionType: "cash" | "vip"; requestId: string }) =>
      call("operator_open_club_tables_v2", {
        p_game_table_ids: args.gameTableIds,
        p_session_type: args.sessionType,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    closeClubTable: (args: { tableSessionId: string; expectedRevision: number; requestId: string }) =>
      call("operator_close_club_table_v2", {
        p_table_session_id: args.tableSessionId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    assignEntryToSeat: (args: { entryId: string; tournamentTableId: string; seatNumber: number; expectedRevision: number; requestId: string }) =>
      call("floor_assign_entry_to_seat", {
        p_entry_id: args.entryId,
        p_tournament_table_id: args.tournamentTableId,
        p_seat_number: args.seatNumber,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    setTableControlMode: (args: { tournamentTableId: string; controlMode: "manual" | "tracker"; expectedRevision: number; requestId: string }) =>
      call("floor_set_table_control_mode_v3", {
        p_tournament_table_id: args.tournamentTableId,
        p_control_mode: args.controlMode,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    movePlayerSeat: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedSourceRevision: number; expectedDestinationRevision: number; requestId: string }) =>
      call("move_player_seat_v2", {
        p_entry_id: args.entryId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_source_revision: args.expectedSourceRevision,
        p_expected_destination_revision: args.expectedDestinationRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    closeTournamentTable: (args: { tournamentTableId: string; expectedRevision: number; requestId: string }) =>
      call("close_tournament_table_v3", {
        p_tournament_table_id: args.tournamentTableId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    breakTournamentTable: (args: { tournamentTableId: string; expectedRevision: number; requestId: string; drawMode: "fill_lowest_table" | "redraw_balanced" }) =>
      call("floor_break_table_v3", {
        p_tournament_table_id: args.tournamentTableId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
        p_draw_mode: args.drawMode,
      }).then(mutationFromResponse),

    bustPlayer: (args: { entryId: string; expectedRevision: number; expectedControlEpoch: number; expectedChipCount: number; requestId: string; reason?: string }) =>
      call("floor_bust_player_v3", {
        p_entry_id: args.entryId,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_expected_chip_count: args.expectedChipCount,
        p_request_id: args.requestId,
        p_reason: args.reason ?? "floor_bust",
      }).then(mutationFromResponse),

    restoreBustedPlayer: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedRevision: number; expectedControlEpoch: number; requestId: string }) =>
      call("floor_restore_busted_player_to_seat_v3", {
        p_entry_id: args.entryId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    validateTrackerContext: (args: { tournamentId: string; tournamentTableId: string; tableSessionId: string; controlEpoch: number }) =>
      call("validate_tracker_table_writer_context_v3", {
        p_tournament_id: args.tournamentId,
        p_tournament_table_id: args.tournamentTableId,
        p_table_session_id: args.tableSessionId,
        p_control_epoch: args.controlEpoch,
      }).then((response) => response.ok ? parseMutation(response.data) : response),
  };
}
