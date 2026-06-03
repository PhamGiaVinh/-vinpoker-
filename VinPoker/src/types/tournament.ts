// ═══════════════════════════════════════════════════════════════════════════════
// Tournament & Swing Config Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface Tournament {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  status: "active" | "completed" | "cancelled";
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface TournamentTable {
  id: string;
  tournament_id: string;
  table_id: string;
  created_at: string;
}

export interface TournamentWithTables extends Tournament {
  tournament_tables: {
    table_id: string;
    game_tables?: {
      id: string;
      table_name: string;
    } | null;
  }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Swing Config Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SwingConfigOverride {
  id: string;
  club_id: string;
  scope_type: "club" | "table";
  scope_id: string | null;
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface EffectiveSwingConfig {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  source: "table" | "tournament" | "club" | "club_legacy" | "default";
}

/** Input shape for creating/updating swing config */
export interface SwingConfigInput {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
}
