/**
 * roomReconcileGraph — pure move-graph classifier for the multi-table room
 * reconcile wizard (#33F). PREVIEW LABELING ONLY: it produces human-friendly
 * component classifications + a displaced-dealer list for the wizard UI. The
 * server `reconcile_dealer_room_state` dry-run remains authoritative for
 * `can_apply`; this never gates the apply.
 *
 * No React, no Supabase, no deps — plain TS so it is unit-testable.
 *
 * Model: the operator selects affected tables and, per table, the dealer
 * ACTUALLY dealing it. To fill table T with dealer A, we must vacate wherever
 * A currently sits. If A sits at another SELECTED table, those tables form a
 * component (edge T -> srcTable). Closed loops are swaps (2) / cycles (3+);
 * open paths are chains whose head dealer (recorded but not re-seated) is
 * displaced and needs a resolution.
 */

export type ComponentKind =
  | "already_correct" // recorded === actual at this table
  | "one_sided_assign" // empty table (or pool dealer) → actual assigned, nobody displaced here
  | "one_sided_release" // recorded dealer → table marked empty (confirm_empty)
  | "swap" // 2-cycle: A↔B across two selected tables
  | "cycle" // closed loop of 3+ selected tables, everyone re-seated
  | "chain"; // open path: head dealer not re-seated (→ displaced)

export interface ReconcileInputRow {
  tableId: string;
  /** Dealer the system currently records at this table (tableAssignmentMap). */
  recordedAttendanceId: string | null;
  /** Dealer the operator says is ACTUALLY dealing; null = mark table empty. */
  actualAttendanceId: string | null;
}

export interface ReconcileGraphInput {
  rows: ReconcileInputRow[];
  /** attendanceId → tableId, inverted over ALL active tables (not just selected). */
  attendanceCurrentTable: Record<string, string>;
}

export interface ClassifiedComponent {
  kind: ComponentKind;
  tableIds: string[];
  /** Dealers involved, aligned to tableIds where meaningful (null = empty). */
  attendanceIds: (string | null)[];
}

export interface DisplacedDealer {
  attendanceId: string;
  /** The selected table where this dealer was recorded but is not re-seated. */
  fromTableId: string;
}

export interface ReconcileGraphResult {
  components: ClassifiedComponent[];
  displaced: DisplacedDealer[];
  flags: {
    /** Same dealer chosen as actual at ≥2 selected tables (server: dealer_duplicate_in_payload). */
    duplicate_actual: string[];
    /** Chosen actual currently sits at a table NOT in the selection (server: dealer_active_elsewhere). */
    actual_active_at_unselected_table: Array<{
      attendanceId: string;
      currentTableId: string;
      neededForTableId: string;
    }>;
  };
}

/**
 * Classify a multi-table reconcile payload into human-friendly components.
 * Deterministic; tableIds within a component are returned in selection order.
 */
export function classifyRoomReconcile(input: ReconcileGraphInput): ReconcileGraphResult {
  const { rows, attendanceCurrentTable } = input;
  const selectedSet = new Set(rows.map((r) => r.tableId));
  const rowByTable = new Map<string, ReconcileInputRow>();
  for (const r of rows) rowByTable.set(r.tableId, r);

  // ── flags.duplicate_actual ────────────────────────────────────────────────
  const actualCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.actualAttendanceId) {
      actualCounts.set(r.actualAttendanceId, (actualCounts.get(r.actualAttendanceId) ?? 0) + 1);
    }
  }
  const duplicate_actual = [...actualCounts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);

  // ── flags.actual_active_at_unselected_table ───────────────────────────────
  const actual_active_at_unselected_table: ReconcileGraphResult["flags"]["actual_active_at_unselected_table"] = [];
  for (const r of rows) {
    const a = r.actualAttendanceId;
    if (!a) continue;
    if (a === r.recordedAttendanceId) continue; // already correct, no move
    const src = attendanceCurrentTable[a];
    if (src && !selectedSet.has(src)) {
      actual_active_at_unselected_table.push({
        attendanceId: a,
        currentTableId: src,
        neededForTableId: r.tableId,
      });
    }
  }

  // ── directed edges among SELECTED tables: T -> srcTable (vacate to fill T) ──
  // adjacency only when the actual dealer sits at another selected table.
  const edge = new Map<string, string>(); // tableId -> srcTable
  for (const r of rows) {
    const a = r.actualAttendanceId;
    if (!a || a === r.recordedAttendanceId) continue;
    const src = attendanceCurrentTable[a];
    if (src && src !== r.tableId && selectedSet.has(src)) {
      edge.set(r.tableId, src);
    }
  }

  // ── weakly-connected components over `edge` (undirected union) ─────────────
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const nxt = parent.get(cur)!;
      parent.set(cur, root);
      cur = nxt;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const tid of selectedSet) parent.set(tid, tid);
  for (const [from, to] of edge.entries()) union(from, to);

  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const root = find(r.tableId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(r.tableId);
  }

  // ── classify each component, preserving selection order within the group ──
  const order = new Map<string, number>();
  rows.forEach((r, i) => order.set(r.tableId, i));
  const components: ClassifiedComponent[] = [];

  for (const tableIds of groups.values()) {
    tableIds.sort((a, b) => (order.get(a)! - order.get(b)!));

    if (tableIds.length === 1) {
      const r = rowByTable.get(tableIds[0])!;
      let kind: ComponentKind;
      if (r.actualAttendanceId === r.recordedAttendanceId) {
        kind = "already_correct";
      } else if (r.actualAttendanceId === null) {
        kind = "one_sided_release"; // recorded dealer leaves; table empty
      } else {
        // actual is a pool dealer (sits nowhere active) or active-elsewhere
        // (flagged separately); from the graph's view it's a one-sided assign.
        kind = "one_sided_assign";
      }
      components.push({
        kind,
        tableIds,
        attendanceIds: [r.actualAttendanceId],
      });
      continue;
    }

    // Multi-table component: closed loop iff every table's actual is supplied
    // by another table IN this component (i.e. every node has an outgoing edge
    // within the group AND every node is some other node's edge target).
    const inGroup = new Set(tableIds);
    const outTargets = tableIds.map((t) => edge.get(t)).filter((t): t is string => !!t && inGroup.has(t));
    const targetSet = new Set(outTargets);
    const everyHasEdge = tableIds.every((t) => {
      const tgt = edge.get(t);
      return !!tgt && inGroup.has(tgt);
    });
    const everyIsTarget = tableIds.every((t) => targetSet.has(t));
    const closedLoop = everyHasEdge && everyIsTarget;

    let kind: ComponentKind;
    if (closedLoop) kind = tableIds.length === 2 ? "swap" : "cycle";
    else kind = "chain";

    components.push({
      kind,
      tableIds,
      attendanceIds: tableIds.map((t) => rowByTable.get(t)!.actualAttendanceId),
    });
  }

  // ── displaced: recorded dealers at a selected table, not chosen actual anywhere selected ──
  const chosenActuals = new Set(rows.map((r) => r.actualAttendanceId).filter((x): x is string => !!x));
  const displaced: DisplacedDealer[] = [];
  for (const r of rows) {
    const rec = r.recordedAttendanceId;
    if (!rec) continue;
    if (rec === r.actualAttendanceId) continue; // stays put
    if (!chosenActuals.has(rec)) {
      displaced.push({ attendanceId: rec, fromTableId: r.tableId });
    }
  }

  return {
    components,
    displaced,
    flags: { duplicate_actual, actual_active_at_unselected_table },
  };
}
