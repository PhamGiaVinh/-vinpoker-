import { isValidationCode } from "./validationMessages";

export interface TableLoadToken {
  readonly tableId: string;
  readonly generation: number;
}

export function createTableLoadGuard() {
  let generation = 0;
  let activeTableId = "";
  let mounted = true;

  return {
    begin(tableId: string): TableLoadToken {
      generation += 1;
      activeTableId = tableId;
      return { tableId, generation };
    },
    capture(tableId: string): TableLoadToken {
      return { tableId, generation };
    },
    isCurrent(token: TableLoadToken): boolean {
      return mounted && token.generation === generation && token.tableId === activeTableId;
    },
    dispose(): void {
      mounted = false;
      generation += 1;
      activeTableId = "";
    },
  };
}

export function buildNextHandNumberRequest(tournamentId: string, tableId: string) {
  return { p_tournament_id: tournamentId, p_table_id: tableId };
}

export type TableHandIdentity =
  | { kind: "resume"; hand: { id: string; hand_number: number } }
  | { kind: "next"; handNumber: number }
  | { kind: "stale" };

/**
 * Resolve an in-progress hand before asking for the next number. This ordering is
 * intentional: a late next-number response must never replace the identity of a
 * hand the operator is resuming.
 */
export async function resolveTableHandIdentity(args: {
  loadOrphan: () => Promise<{ id: string; hand_number: number } | null>;
  loadNextHandNumber: () => Promise<number>;
  isCurrent: () => boolean;
}): Promise<TableHandIdentity> {
  const orphan = await args.loadOrphan();
  if (!args.isCurrent()) return { kind: "stale" };
  if (orphan) return { kind: "resume", hand: orphan };

  const handNumber = await args.loadNextHandNumber();
  if (!args.isCurrent()) return { kind: "stale" };
  return { kind: "next", handNumber };
}

export interface ActionWriteToken {
  readonly id: number;
  readonly scope: string;
}

export function createActionWriteGuard() {
  let nextId = 1;
  let inFlight: ActionWriteToken | null = null;
  const blockedScopes = new Set<string>();

  const owns = (token: ActionWriteToken) => inFlight?.id === token.id && inFlight.scope === token.scope;

  return {
    begin(scope: string): ActionWriteToken | null {
      if (inFlight || blockedScopes.has(scope)) return null;
      const token = { id: nextId, scope };
      nextId += 1;
      inFlight = token;
      return token;
    },
    finish(token: ActionWriteToken): boolean {
      if (!owns(token)) return false;
      inFlight = null;
      return true;
    },
    markUncertain(token: ActionWriteToken): boolean {
      if (!owns(token)) return false;
      inFlight = null;
      blockedScopes.add(token.scope);
      return true;
    },
    invalidate(scope: string): void {
      if (inFlight?.scope === scope) inFlight = null;
      blockedScopes.delete(scope);
    },
    isBusy(): boolean {
      return inFlight !== null;
    },
    isBlocked(scope: string): boolean {
      return blockedScopes.has(scope);
    },
  };
}

export function classifyActionWriteFailure(input: { code?: unknown; message?: unknown; data?: unknown }): "validation" | "uncertain" {
  return typeof input.code === "string" && isValidationCode(input.code) ? "validation" : "uncertain";
}

export function isConfirmedActionWrite(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return record.status === "success" && Object.prototype.hasOwnProperty.call(record, "data");
}
