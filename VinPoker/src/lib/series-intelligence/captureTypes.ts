// Series Intelligence — CAPTURE v0 shared types + option arrays.
// Row/Insert/Update aliases come straight from the generated Supabase types (source of truth — never
// hand-declare column shapes here). Option arrays + Vietnamese labels drive the form <select>s so the UI
// can only emit values the DB CHECK constraints allow.
import type { Database } from "@/integrations/supabase/types";

type Tbl = Database["public"]["Tables"];

export type ForecastSnapshot = Tbl["series_forecast_snapshots"]["Row"];
export type ForecastSnapshotInsert = Tbl["series_forecast_snapshots"]["Insert"];
export type DecisionLog = Tbl["series_decision_logs"]["Row"];
export type DecisionLogInsert = Tbl["series_decision_logs"]["Insert"];
export type DecisionLogUpdate = Tbl["series_decision_logs"]["Update"];
export type CampaignLog = Tbl["series_campaign_logs"]["Row"];
export type CampaignLogInsert = Tbl["series_campaign_logs"]["Insert"];
export type CampaignLogUpdate = Tbl["series_campaign_logs"]["Update"];
export type RegistrationEvent = Tbl["series_registration_events"]["Row"];
export type RegistrationEventInsert = Tbl["series_registration_events"]["Insert"];

/** A club tournament the owner can attach capture rows to (event picker source). */
export interface CaptureEventOption {
  id: string;
  name: string;
  club_id: string;
  start_time: string | null;
  status: string | null;
}

// ── Enum option arrays (must match the migration CHECK constraints exactly) ─────────────────────────
export const HORIZONS = ["T-21", "T-7", "T-1", "T-0"] as const; // forecast snapshots (pre-event only)
export const DECISION_HORIZONS = ["T-21", "T-7", "T-1", "T-0", "post"] as const; // decisions add 'post'
export const CONFIDENCE_TIERS = ["low", "medium", "high"] as const;
export const COMMITMENT_STAGES = ["interested", "reserved", "paid", "seated", "cancelled"] as const;
export const ENTRY_SOURCES = ["direct", "online", "floor", "satellite", "unknown"] as const;
export const PLAYER_REF_TYPES = ["phone", "app_user_id", "host_label"] as const;

// ── Vietnamese labels ───────────────────────────────────────────────────────────────────────────────
export const HORIZON_LABEL: Record<string, string> = {
  "T-21": "T-21 · 3 tuần trước",
  "T-7": "T-7 · 1 tuần trước",
  "T-1": "T-1 · 1 ngày trước",
  "T-0": "T-0 · ngày giải",
  post: "Sau giải",
};
export const CONFIDENCE_LABEL: Record<string, string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };
export const COMMITMENT_LABEL: Record<string, string> = {
  interested: "Quan tâm",
  reserved: "Giữ chỗ",
  paid: "Đã đóng phí",
  seated: "Đã vào bàn",
  cancelled: "Huỷ",
};
export const ENTRY_SOURCE_LABEL: Record<string, string> = {
  direct: "Trực tiếp",
  online: "Online",
  floor: "Tại sàn",
  satellite: "Satellite",
  unknown: "Không rõ",
};
export const PLAYER_REF_TYPE_LABEL: Record<string, string> = {
  phone: "SĐT (đã hash)",
  app_user_id: "App user (đã hash)",
  host_label: "Nhãn host (đã hash)",
};

/** Funnel display order for commitment stages. */
export const STAGE_ORDER = COMMITMENT_STAGES;

/** Short plain-Vietnamese horizon labels for the timeline nodes (no "T-minus" jargon). */
export const HORIZON_SHORT: Record<string, string> = {
  "T-21": "3 tuần",
  "T-7": "1 tuần",
  "T-1": "1 ngày",
  "T-0": "Ngày giải",
  post: "Sau giải",
};
