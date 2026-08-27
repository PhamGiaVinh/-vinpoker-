import type { SupabaseClient } from "@supabase/supabase-js";

export type TrackerFloorAlertStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "dismissed";

export interface TrackerFloorAlert {
  readonly id: string;
  readonly tournament_id: string;
  readonly tournament_table_id: string;
  readonly hand_id: string | null;
  readonly dealer_name: string | null;
  readonly alert_kind: "wrong_action" | "call_floor";
  readonly priority: "high" | "urgent";
  readonly status: TrackerFloorAlertStatus;
  readonly version: number;
  readonly correction_required: boolean;
  readonly title: string;
  readonly message: string | null;
  readonly created_at: string;
}

export type TrackerFloorAlertReadResult =
  | { readonly ok: true; readonly alerts: readonly TrackerFloorAlert[] }
  | { readonly ok: false; readonly error: string };

export type TrackerFloorAlertReadClient = Pick<SupabaseClient, "rpc">;

function isAlert(value: unknown): value is TrackerFloorAlert {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.tournament_id === "string"
    && typeof row.tournament_table_id === "string"
    && typeof row.title === "string"
    && typeof row.created_at === "string"
    && ["open", "acknowledged", "in_progress", "resolved", "dismissed"].includes(String(row.status))
    && ["wrong_action", "call_floor"].includes(String(row.alert_kind))
    && ["high", "urgent"].includes(String(row.priority))
    && Number.isSafeInteger(row.version)
    && typeof row.correction_required === "boolean"
    && (row.hand_id === null || typeof row.hand_id === "string")
    && (row.dealer_name === null || typeof row.dealer_name === "string")
    && (row.message === null || typeof row.message === "string");
}

/** Read-only shared loader. It intentionally has no subscriptions or transitions. */
export async function listTrackerFloorAlerts(
  client: TrackerFloorAlertReadClient,
  tournamentId: string,
): Promise<TrackerFloorAlertReadResult> {
  try {
    const { data, error } = await client.rpc("list_tracker_floor_alerts" as never, {
      p_tournament_id: tournamentId,
      p_status: null,
    } as never);
    if (error) return { ok: false, error: error.message };
    const payload = data as { ok?: boolean; error?: string; alerts?: unknown } | null;
    if (!payload?.ok || !Array.isArray(payload.alerts) || payload.alerts.some((item) => !isAlert(item))) {
      return { ok: false, error: payload?.error ?? "TRACKER_ALERT_READ_MALFORMED" };
    }
    return {
      ok: true,
      alerts: payload.alerts.filter((alert) => !["resolved", "dismissed"].includes(alert.status)),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "TRACKER_ALERT_READ_FAILED" };
  }
}
