export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      all_time_money_list: {
        Row: {
          display_name: string
          id: string
          imported_at: string
          imported_by: string | null
          player_id: string | null
          rank_source: number | null
          total_winnings: number
        }
        Insert: {
          display_name: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          player_id?: string | null
          rank_source?: number | null
          total_winnings?: number
        }
        Update: {
          display_name?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          player_id?: string | null
          rank_source?: number | null
          total_winnings?: number
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          club_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          payload: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          club_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          club_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      backer_reviews: {
        Row: {
          backer_id: string
          comment: string | null
          created_at: string
          deal_amount: number | null
          id: string
          player_id: string
          rating: number
          updated_at: string
          verified: boolean
        }
        Insert: {
          backer_id: string
          comment?: string | null
          created_at?: string
          deal_amount?: number | null
          id?: string
          player_id: string
          rating: number
          updated_at?: string
          verified?: boolean
        }
        Update: {
          backer_id?: string
          comment?: string | null
          created_at?: string
          deal_amount?: number | null
          id?: string
          player_id?: string
          rating?: number
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      backing_interests: {
        Row: {
          created_at: string
          id: string
          interested_user_id: string
          message: string | null
          percentage_interested: number
          player_id: string
          status: Database["public"]["Enums"]["backing_interest_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          interested_user_id: string
          message?: string | null
          percentage_interested: number
          player_id: string
          status?: Database["public"]["Enums"]["backing_interest_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          interested_user_id?: string
          message?: string | null
          percentage_interested?: number
          player_id?: string
          status?: Database["public"]["Enums"]["backing_interest_status"]
          updated_at?: string
        }
        Relationships: []
      }
      bankroll_entries: {
        Row: {
          buyin: number | null
          created_at: string
          entries: number | null
          entry_date: string
          game_type: string
          hours: number | null
          id: string
          notes: string | null
          prize_won: number | null
          profit_loss: number | null
          rake: number | null
          stakes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          buyin?: number | null
          created_at?: string
          entries?: number | null
          entry_date?: string
          game_type: string
          hours?: number | null
          id?: string
          notes?: string | null
          prize_won?: number | null
          profit_loss?: number | null
          rake?: number | null
          stakes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          buyin?: number | null
          created_at?: string
          entries?: number | null
          entry_date?: string
          game_type?: string
          hours?: number | null
          id?: string
          notes?: string | null
          prize_won?: number | null
          profit_loss?: number | null
          rake?: number | null
          stakes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bankroll_settings: {
        Row: {
          currency: string
          ror_threshold: number
          starting_bankroll: number
          updated_at: string
          user_id: string
        }
        Insert: {
          currency?: string
          ror_threshold?: number
          starting_bankroll?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          currency?: string
          ror_threshold?: number
          starting_bankroll?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      booking_chats: {
        Row: {
          archived_at: string | null
          closed_at: string | null
          closed_by: string | null
          club_id: string
          club_last_read_at: string
          created_at: string
          id: string
          payment_confirmed: boolean
          player_id: string
          player_last_read_at: string
          registration_id: string | null
          status: string
          tournament_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          club_id: string
          club_last_read_at?: string
          created_at?: string
          id?: string
          payment_confirmed?: boolean
          player_id: string
          player_last_read_at?: string
          registration_id?: string | null
          status?: string
          tournament_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          club_id?: string
          club_last_read_at?: string
          created_at?: string
          id?: string
          payment_confirmed?: boolean
          player_id?: string
          player_last_read_at?: string
          registration_id?: string | null
          status?: string
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_chats_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_chats_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_chats_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "stack_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          group_id: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          token: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          group_id: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          token: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          token?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_members: {
        Row: {
          group_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          content: string | null
          created_at: string
          deleted_at: string | null
          group_id: string
          id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          group_id: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          is_public: boolean
          name: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          is_public?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          is_public?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          kind: string
          sender_id: string | null
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          kind?: string
          sender_id?: string | null
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "booking_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      club_cashiers: {
        Row: {
          club_id: string
          created_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_cashiers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_cashiers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_dealer_controls: {
        Row: {
          club_id: string
          created_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_dealer_controls_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_dealer_controls_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_members: {
        Row: {
          cccd: string | null
          club_id: string
          created_at: string
          full_name: string | null
          id: string
          member_card_id: string
          phone: string | null
          player_user_id: string | null
          source: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          cccd?: string | null
          club_id: string
          created_at?: string
          full_name?: string | null
          id?: string
          member_card_id: string
          phone?: string | null
          player_user_id?: string | null
          source?: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          cccd?: string | null
          club_id?: string
          created_at?: string
          full_name?: string | null
          id?: string
          member_card_id?: string
          phone?: string | null
          player_user_id?: string | null
          source?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_money_list: {
        Row: {
          club_id: string
          display_name: string
          id: string
          imported_at: string
          imported_by: string | null
          player_id: string | null
          rank_source: number | null
          total_winnings: number
        }
        Insert: {
          club_id: string
          display_name: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          player_id?: string | null
          rank_source?: number | null
          total_winnings?: number
        }
        Update: {
          club_id?: string
          display_name?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          player_id?: string | null
          rank_source?: number | null
          total_winnings?: number
        }
        Relationships: []
      }
      club_processing_locks: {
        Row: {
          club_id: string
          expires_at: string
          locked_at: string
          locked_by: string
        }
        Insert: {
          club_id: string
          expires_at: string
          locked_at?: string
          locked_by?: string
        }
        Update: {
          club_id?: string
          expires_at?: string
          locked_at?: string
          locked_by?: string
        }
        Relationships: []
      }
      club_settings: {
        Row: {
          auto_swing_enabled: boolean
          club_id: string
          created_at: string
          floor_manager_chat_id: string | null
          id: string
          shortage_auto_close_enabled: boolean
          shortage_close_threshold: number
          shortage_notify_telegram: boolean
          standard_shifts_per_month: number
          telegram_chat_id: string | null
          timezone: string
        }
        Insert: {
          auto_swing_enabled?: boolean
          club_id: string
          created_at?: string
          floor_manager_chat_id?: string | null
          id?: string
          shortage_auto_close_enabled?: boolean
          shortage_close_threshold?: number
          shortage_notify_telegram?: boolean
          standard_shifts_per_month?: number
          telegram_chat_id?: string | null
          timezone?: string
        }
        Update: {
          auto_swing_enabled?: boolean
          club_id?: string
          created_at?: string
          floor_manager_chat_id?: string | null
          id?: string
          shortage_auto_close_enabled?: boolean
          shortage_close_threshold?: number
          shortage_notify_telegram?: boolean
          standard_shifts_per_month?: number
          telegram_chat_id?: string | null
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_settings_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_settings_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_trackers: {
        Row: {
          club_id: string
          created_at: string | null
          granted_by: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string | null
          granted_by: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string | null
          granted_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_trackers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_trackers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_wallets: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          network: string
          updated_at: string
          wallet_address: string
          wallet_label: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          network?: string
          updated_at?: string
          wallet_address: string
          wallet_label?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          network?: string
          updated_at?: string
          wallet_address?: string
          wallet_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_wallets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_wallets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          address: string | null
          auto_sync_url: string | null
          bot_enabled: boolean
          bot_qr_url: string | null
          bot_welcome_message: string
          cover_url: string | null
          created_at: string
          daily_schedule_image_url: string | null
          description: string | null
          id: string
          last_critical_alert_at: string | null
          name: string
          owner_id: string | null
          rating: number
          region: string
          schedule: string | null
          schedule_sort_order: number
          status: Database["public"]["Enums"]["club_status"]
          updated_at: string
          weekly_schedule_image_url: string | null
        }
        Insert: {
          address?: string | null
          auto_sync_url?: string | null
          bot_enabled?: boolean
          bot_qr_url?: string | null
          bot_welcome_message?: string
          cover_url?: string | null
          created_at?: string
          daily_schedule_image_url?: string | null
          description?: string | null
          id?: string
          last_critical_alert_at?: string | null
          name: string
          owner_id?: string | null
          rating?: number
          region: string
          schedule?: string | null
          schedule_sort_order?: number
          status?: Database["public"]["Enums"]["club_status"]
          updated_at?: string
          weekly_schedule_image_url?: string | null
        }
        Update: {
          address?: string | null
          auto_sync_url?: string | null
          bot_enabled?: boolean
          bot_qr_url?: string | null
          bot_welcome_message?: string
          cover_url?: string | null
          created_at?: string
          daily_schedule_image_url?: string | null
          description?: string | null
          id?: string
          last_critical_alert_at?: string | null
          name?: string
          owner_id?: string | null
          rating?: number
          region?: string
          schedule?: string | null
          schedule_sort_order?: number
          status?: Database["public"]["Enums"]["club_status"]
          updated_at?: string
          weekly_schedule_image_url?: string | null
        }
        Relationships: []
      }
      cron_execution_log: {
        Row: {
          error: string | null
          executed_at: string
          id: number
          job_name: string
          result: Json | null
        }
        Insert: {
          error?: string | null
          executed_at?: string
          id?: number
          job_name: string
          result?: Json | null
        }
        Update: {
          error?: string | null
          executed_at?: string
          id?: number
          job_name?: string
          result?: Json | null
        }
        Relationships: []
      }
      cron_metrics: {
        Row: {
          club_id: string | null
          created_at: string
          cron_name: string
          duration_ms: number
          error_count: number
          error_message: string | null
          executed_at: string
          id: string
          metadata: Json | null
          processed_count: number
          status: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          cron_name: string
          duration_ms: number
          error_count?: number
          error_message?: string | null
          executed_at?: string
          id?: string
          metadata?: Json | null
          processed_count?: number
          status: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          cron_name?: string
          duration_ms?: number
          error_count?: number
          error_message?: string | null
          executed_at?: string
          id?: string
          metadata?: Json | null
          processed_count?: number
          status?: string
        }
        Relationships: []
      }
      deal_ratings: {
        Row: {
          comment: string | null
          created_at: string
          deal_id: string
          id: string
          ratee_id: string
          rater_id: string
          rating: number
          role: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          deal_id: string
          id?: string
          ratee_id: string
          rater_id: string
          rating: number
          role: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          ratee_id?: string
          rater_id?: string
          rating?: number
          role?: string
        }
        Relationships: []
      }
      dealer_assignment_corrections: {
        Row: {
          admin_override: boolean
          affected_attendance_ids: string[]
          affected_dealer_ids: string[]
          affected_table_ids: string[]
          after_snapshot: Json
          before_snapshot: Json
          club_id: string
          created_at: string
          created_by: string | null
          diff: Json
          effective_at: string
          id: string
          reason: string
        }
        Insert: {
          admin_override?: boolean
          affected_attendance_ids: string[]
          affected_dealer_ids: string[]
          affected_table_ids: string[]
          after_snapshot: Json
          before_snapshot: Json
          club_id: string
          created_at?: string
          created_by?: string | null
          diff: Json
          effective_at: string
          id?: string
          reason: string
        }
        Update: {
          admin_override?: boolean
          affected_attendance_ids?: string[]
          affected_dealer_ids?: string[]
          affected_table_ids?: string[]
          after_snapshot?: Json
          before_snapshot?: Json
          club_id?: string
          created_at?: string
          created_by?: string | null
          diff?: Json
          effective_at?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_assignment_corrections_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignment_corrections_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_assignment_version_audit: {
        Row: {
          app_state_reason: string
          changed_at: string
          changed_by: string | null
          id: number
          new_status: string | null
          new_version: number
          old_status: string | null
          old_version: number
          row_id: string
        }
        Insert: {
          app_state_reason: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_status?: string | null
          new_version: number
          old_status?: string | null
          old_version: number
          row_id: string
        }
        Update: {
          app_state_reason?: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_status?: string | null
          new_version?: number
          old_status?: string | null
          old_version?: number
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_assignment_version_audit_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "dealer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignment_version_audit_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "v_stuck_assignment_version_history"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_assignments: {
        Row: {
          assigned_at: string
          attendance_id: string
          club_id: string
          created_at: string
          dealer_id: string | null
          duration_minutes: number | null
          id: string
          idempotency_key: string | null
          is_emergency_pre_assign: boolean
          last_ot_alert_at: string | null
          last_swing_attempted_at: string | null
          needs_replacement: boolean
          overtime_started_at: string | null
          planned_relief_at: string | null
          pre_announce_due_at: string | null
          pre_announced: boolean
          pre_assigned_at: string | null
          pre_assigned_attendance_id: string | null
          priority_swing_at: string | null
          release_reason: string | null
          released_at: string | null
          should_audit_version: boolean
          status: string
          swing_due_at: string
          swing_fallback_reason: string | null
          swing_in_progress: boolean | null
          swing_processed_at: string | null
          swing_retry_count: number
          table_id: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_at?: string
          attendance_id: string
          club_id: string
          created_at?: string
          dealer_id?: string | null
          duration_minutes?: number | null
          id?: string
          idempotency_key?: string | null
          is_emergency_pre_assign?: boolean
          last_ot_alert_at?: string | null
          last_swing_attempted_at?: string | null
          needs_replacement?: boolean
          overtime_started_at?: string | null
          planned_relief_at?: string | null
          pre_announce_due_at?: string | null
          pre_announced?: boolean
          pre_assigned_at?: string | null
          pre_assigned_attendance_id?: string | null
          priority_swing_at?: string | null
          release_reason?: string | null
          released_at?: string | null
          should_audit_version?: boolean
          status?: string
          swing_due_at: string
          swing_fallback_reason?: string | null
          swing_in_progress?: boolean | null
          swing_processed_at?: string | null
          swing_retry_count?: number
          table_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_at?: string
          attendance_id?: string
          club_id?: string
          created_at?: string
          dealer_id?: string | null
          duration_minutes?: number | null
          id?: string
          idempotency_key?: string | null
          is_emergency_pre_assign?: boolean
          last_ot_alert_at?: string | null
          last_swing_attempted_at?: string | null
          needs_replacement?: boolean
          overtime_started_at?: string | null
          planned_relief_at?: string | null
          pre_announce_due_at?: string | null
          pre_announced?: boolean
          pre_assigned_at?: string | null
          pre_assigned_attendance_id?: string | null
          priority_swing_at?: string | null
          release_reason?: string | null
          released_at?: string | null
          should_audit_version?: boolean
          status?: string
          swing_due_at?: string
          swing_fallback_reason?: string | null
          swing_in_progress?: boolean | null
          swing_processed_at?: string | null
          swing_retry_count?: number
          table_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_assignments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_assignments_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_assignments_backup_20260605: {
        Row: {
          assigned_at: string | null
          attendance_id: string | null
          club_id: string | null
          created_at: string | null
          dealer_id: string | null
          duration_minutes: number | null
          id: string | null
          idempotency_key: string | null
          last_ot_alert_at: string | null
          last_swing_attempted_at: string | null
          needs_replacement: boolean | null
          overtime_started_at: string | null
          pre_announce_due_at: string | null
          pre_announced: boolean | null
          pre_assigned_at: string | null
          pre_assigned_attendance_id: string | null
          priority_swing_at: string | null
          released_at: string | null
          status: string | null
          swing_due_at: string | null
          swing_fallback_reason: string | null
          swing_processed_at: string | null
          swing_retry_count: number | null
          table_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          assigned_at?: string | null
          attendance_id?: string | null
          club_id?: string | null
          created_at?: string | null
          dealer_id?: string | null
          duration_minutes?: number | null
          id?: string | null
          idempotency_key?: string | null
          last_ot_alert_at?: string | null
          last_swing_attempted_at?: string | null
          needs_replacement?: boolean | null
          overtime_started_at?: string | null
          pre_announce_due_at?: string | null
          pre_announced?: boolean | null
          pre_assigned_at?: string | null
          pre_assigned_attendance_id?: string | null
          priority_swing_at?: string | null
          released_at?: string | null
          status?: string | null
          swing_due_at?: string | null
          swing_fallback_reason?: string | null
          swing_processed_at?: string | null
          swing_retry_count?: number | null
          table_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          assigned_at?: string | null
          attendance_id?: string | null
          club_id?: string | null
          created_at?: string | null
          dealer_id?: string | null
          duration_minutes?: number | null
          id?: string | null
          idempotency_key?: string | null
          last_ot_alert_at?: string | null
          last_swing_attempted_at?: string | null
          needs_replacement?: boolean | null
          overtime_started_at?: string | null
          pre_announce_due_at?: string | null
          pre_announced?: boolean | null
          pre_assigned_at?: string | null
          pre_assigned_attendance_id?: string | null
          priority_swing_at?: string | null
          released_at?: string | null
          status?: string | null
          swing_due_at?: string | null
          swing_fallback_reason?: string | null
          swing_processed_at?: string | null
          swing_retry_count?: number | null
          table_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      dealer_attendance: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          current_ot_display_minutes: number
          current_state: string | null
          dealer_id: string
          id: string
          last_meal_break_at: string | null
          last_released_at: string | null
          overtime_minutes: number
          pool_entered_at: string | null
          pre_assigned_at: string | null
          pre_assigned_table_id: string | null
          priority_break_flag: boolean | null
          shift_date: string
          shift_id: string | null
          status: string
          total_worked_minutes_today: number | null
          updated_at: string | null
          worked_minutes_since_last_break: number | null
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          current_ot_display_minutes?: number
          current_state?: string | null
          dealer_id: string
          id?: string
          last_meal_break_at?: string | null
          last_released_at?: string | null
          overtime_minutes?: number
          pool_entered_at?: string | null
          pre_assigned_at?: string | null
          pre_assigned_table_id?: string | null
          priority_break_flag?: boolean | null
          shift_date?: string
          shift_id?: string | null
          status?: string
          total_worked_minutes_today?: number | null
          updated_at?: string | null
          worked_minutes_since_last_break?: number | null
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          current_ot_display_minutes?: number
          current_state?: string | null
          dealer_id?: string
          id?: string
          last_meal_break_at?: string | null
          last_released_at?: string | null
          overtime_minutes?: number
          pool_entered_at?: string | null
          pre_assigned_at?: string | null
          pre_assigned_table_id?: string | null
          priority_break_flag?: boolean | null
          shift_date?: string
          shift_id?: string | null
          status?: string
          total_worked_minutes_today?: number | null
          updated_at?: string | null
          worked_minutes_since_last_break?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_attendance_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_pre_assigned_table_id_fkey"
            columns: ["pre_assigned_table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "dealer_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_attendance_backup_20260605: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string | null
          current_ot_display_minutes: number | null
          current_state: string | null
          dealer_id: string | null
          id: string | null
          overtime_minutes: number | null
          pre_assigned_at: string | null
          pre_assigned_table_id: string | null
          priority_break_flag: boolean | null
          shift_date: string | null
          shift_id: string | null
          status: string | null
          total_worked_minutes_today: number | null
          worked_minutes_since_last_break: number | null
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          current_ot_display_minutes?: number | null
          current_state?: string | null
          dealer_id?: string | null
          id?: string | null
          overtime_minutes?: number | null
          pre_assigned_at?: string | null
          pre_assigned_table_id?: string | null
          priority_break_flag?: boolean | null
          shift_date?: string | null
          shift_id?: string | null
          status?: string | null
          total_worked_minutes_today?: number | null
          worked_minutes_since_last_break?: number | null
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          current_ot_display_minutes?: number | null
          current_state?: string | null
          dealer_id?: string | null
          id?: string | null
          overtime_minutes?: number | null
          pre_assigned_at?: string | null
          pre_assigned_table_id?: string | null
          priority_break_flag?: boolean | null
          shift_date?: string | null
          shift_id?: string | null
          status?: string | null
          total_worked_minutes_today?: number | null
          worked_minutes_since_last_break?: number | null
        }
        Relationships: []
      }
      dealer_attendance_log: {
        Row: {
          attendance_id: string
          changed_by: string | null
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          dealer_id: string
          id: string
          new_status: string
          old_status: string | null
          shift_date: string
          shift_id: string | null
        }
        Insert: {
          attendance_id: string
          changed_by?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          dealer_id: string
          id?: string
          new_status: string
          old_status?: string | null
          shift_date?: string
          shift_id?: string | null
        }
        Update: {
          attendance_id?: string
          changed_by?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          dealer_id?: string
          id?: string
          new_status?: string
          old_status?: string | null
          shift_date?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_attendance_log_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_log_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_log_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_attendance_log_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_log_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "dealer_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_breaks: {
        Row: {
          assignment_id: string | null
          attendance_id: string | null
          break_end: string | null
          break_start: string
          club_id: string | null
          created_at: string
          expected_duration_minutes: number
          id: string
          reason: string | null
        }
        Insert: {
          assignment_id?: string | null
          attendance_id?: string | null
          break_end?: string | null
          break_start?: string
          club_id?: string | null
          created_at?: string
          expected_duration_minutes?: number
          id?: string
          reason?: string | null
        }
        Update: {
          assignment_id?: string | null
          attendance_id?: string | null
          break_end?: string | null
          break_start?: string
          club_id?: string | null
          created_at?: string
          expected_duration_minutes?: number
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_breaks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "dealer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_breaks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_stuck_assignment_version_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_breaks_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_breaks_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_incidents: {
        Row: {
          created_at: string
          dealer_id: string
          description: string | null
          id: string
          incident_type: string
          reported_by: string | null
          resolved: boolean
          table_id: string | null
        }
        Insert: {
          created_at?: string
          dealer_id: string
          description?: string | null
          id?: string
          incident_type: string
          reported_by?: string | null
          resolved?: boolean
          table_id?: string | null
        }
        Update: {
          created_at?: string
          dealer_id?: string
          description?: string | null
          id?: string
          incident_type?: string
          reported_by?: string | null
          resolved?: boolean
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_incidents_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_incidents_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_meal_breaks: {
        Row: {
          attendance_id: string
          base_duration_minutes: number
          bonus_minutes: number
          break_end: string | null
          break_start: string
          club_id: string
          created_at: string | null
          dealer_id: string
          id: string
          pool_size_at_start: number | null
          status: string
          tables_active_at_start: number | null
          total_duration_minutes: number
        }
        Insert: {
          attendance_id: string
          base_duration_minutes: number
          bonus_minutes?: number
          break_end?: string | null
          break_start?: string
          club_id: string
          created_at?: string | null
          dealer_id: string
          id?: string
          pool_size_at_start?: number | null
          status?: string
          tables_active_at_start?: number | null
          total_duration_minutes: number
        }
        Update: {
          attendance_id?: string
          base_duration_minutes?: number
          bonus_minutes?: number
          break_end?: string | null
          break_start?: string
          club_id?: string
          created_at?: string | null
          dealer_id?: string
          id?: string
          pool_size_at_start?: number | null
          status?: string
          tables_active_at_start?: number | null
          total_duration_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "dealer_meal_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_meal_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_meal_breaks_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_meal_breaks_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_meal_breaks_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_meal_breaks_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_pay_rates: {
        Row: {
          base_rate: number
          club_id: string
          created_at: string
          id: string
          overtime_rate: number
          part_time_rate: number | null
          tier: string
        }
        Insert: {
          base_rate?: number
          club_id: string
          created_at?: string
          id?: string
          overtime_rate?: number
          part_time_rate?: number | null
          tier: string
        }
        Update: {
          base_rate?: number
          club_id?: string
          created_at?: string
          id?: string
          overtime_rate?: number
          part_time_rate?: number | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_pay_rates_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_pay_rates_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_payroll: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_salary_vnd: number | null
          bhtn_deduction_vnd: number
          bhxh_deduction_vnd: number
          bhyt_deduction_vnd: number
          calculated_at: string | null
          calculated_by: string | null
          club_id: string
          created_at: string | null
          dealer_id: string
          employment_type: string
          gross_pay_vnd: number | null
          hourly_rate_vnd: number | null
          id: string
          monthly_salary_vnd: number | null
          net_pay_after_tax_vnd: number
          net_pay_vnd: number | null
          notes: string | null
          ot_hours: number | null
          ot_multiplier: number | null
          ot_pay_vnd: number | null
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_reference: string | null
          period_id: string
          pit_deduction_vnd: number
          regular_hours: number | null
          regular_pay_vnd: number | null
          status: string | null
          tips_amount_vnd: number
          total_adjustments_vnd: number | null
          total_hours: number | null
          total_shifts: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary_vnd?: number | null
          bhtn_deduction_vnd?: number
          bhxh_deduction_vnd?: number
          bhyt_deduction_vnd?: number
          calculated_at?: string | null
          calculated_by?: string | null
          club_id: string
          created_at?: string | null
          dealer_id: string
          employment_type: string
          gross_pay_vnd?: number | null
          hourly_rate_vnd?: number | null
          id?: string
          monthly_salary_vnd?: number | null
          net_pay_after_tax_vnd?: number
          net_pay_vnd?: number | null
          notes?: string | null
          ot_hours?: number | null
          ot_multiplier?: number | null
          ot_pay_vnd?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          period_id: string
          pit_deduction_vnd?: number
          regular_hours?: number | null
          regular_pay_vnd?: number | null
          status?: string | null
          tips_amount_vnd?: number
          total_adjustments_vnd?: number | null
          total_hours?: number | null
          total_shifts?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary_vnd?: number | null
          bhtn_deduction_vnd?: number
          bhxh_deduction_vnd?: number
          bhyt_deduction_vnd?: number
          calculated_at?: string | null
          calculated_by?: string | null
          club_id?: string
          created_at?: string | null
          dealer_id?: string
          employment_type?: string
          gross_pay_vnd?: number | null
          hourly_rate_vnd?: number | null
          id?: string
          monthly_salary_vnd?: number | null
          net_pay_after_tax_vnd?: number
          net_pay_vnd?: number | null
          notes?: string | null
          ot_hours?: number | null
          ot_multiplier?: number | null
          ot_pay_vnd?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          period_id?: string
          pit_deduction_vnd?: number
          regular_hours?: number | null
          regular_pay_vnd?: number | null
          status?: string | null
          tips_amount_vnd?: number
          total_adjustments_vnd?: number | null
          total_hours?: number | null
          total_shifts?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_payroll_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_payroll_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_payroll_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_payroll_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_payroll_backup_202606_20260608_205754: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_salary_vnd: number | null
          bhtn_deduction_vnd: number | null
          bhxh_deduction_vnd: number | null
          bhyt_deduction_vnd: number | null
          calculated_at: string | null
          calculated_by: string | null
          club_id: string | null
          created_at: string | null
          dealer_id: string | null
          employment_type: string | null
          gross_pay_vnd: number | null
          hourly_rate_vnd: number | null
          id: string | null
          monthly_salary_vnd: number | null
          net_pay_after_tax_vnd: number | null
          net_pay_vnd: number | null
          notes: string | null
          ot_hours: number | null
          ot_multiplier: number | null
          ot_pay_vnd: number | null
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_reference: string | null
          period_id: string | null
          period_month: number | null
          period_year: number | null
          pit_deduction_vnd: number | null
          regular_hours: number | null
          regular_pay_vnd: number | null
          status: string | null
          tips_amount_vnd: number | null
          total_adjustments_vnd: number | null
          total_hours: number | null
          total_shifts: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary_vnd?: number | null
          bhtn_deduction_vnd?: number | null
          bhxh_deduction_vnd?: number | null
          bhyt_deduction_vnd?: number | null
          calculated_at?: string | null
          calculated_by?: string | null
          club_id?: string | null
          created_at?: string | null
          dealer_id?: string | null
          employment_type?: string | null
          gross_pay_vnd?: number | null
          hourly_rate_vnd?: number | null
          id?: string | null
          monthly_salary_vnd?: number | null
          net_pay_after_tax_vnd?: number | null
          net_pay_vnd?: number | null
          notes?: string | null
          ot_hours?: number | null
          ot_multiplier?: number | null
          ot_pay_vnd?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          period_id?: string | null
          period_month?: number | null
          period_year?: number | null
          pit_deduction_vnd?: number | null
          regular_hours?: number | null
          regular_pay_vnd?: number | null
          status?: string | null
          tips_amount_vnd?: number | null
          total_adjustments_vnd?: number | null
          total_hours?: number | null
          total_shifts?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary_vnd?: number | null
          bhtn_deduction_vnd?: number | null
          bhxh_deduction_vnd?: number | null
          bhyt_deduction_vnd?: number | null
          calculated_at?: string | null
          calculated_by?: string | null
          club_id?: string | null
          created_at?: string | null
          dealer_id?: string | null
          employment_type?: string | null
          gross_pay_vnd?: number | null
          hourly_rate_vnd?: number | null
          id?: string | null
          monthly_salary_vnd?: number | null
          net_pay_after_tax_vnd?: number | null
          net_pay_vnd?: number | null
          notes?: string | null
          ot_hours?: number | null
          ot_multiplier?: number | null
          ot_pay_vnd?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          period_id?: string | null
          period_month?: number | null
          period_year?: number | null
          pit_deduction_vnd?: number | null
          regular_hours?: number | null
          regular_pay_vnd?: number | null
          status?: string | null
          tips_amount_vnd?: number | null
          total_adjustments_vnd?: number | null
          total_hours?: number | null
          total_shifts?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dealer_rotation_schedule: {
        Row: {
          announce_at: string | null
          assignment_id: string | null
          club_id: string
          created_at: string
          id: string
          in_attendance_id: string | null
          is_emergency: boolean
          is_shortage: boolean
          out_attendance_id: string | null
          plan_run_id: string
          planned_relief_at: string
          reason: Json
          score: number | null
          slot_index: number
          solver_version: string
          status: string
          table_id: string
          updated_at: string
          version: number
        }
        Insert: {
          announce_at?: string | null
          assignment_id?: string | null
          club_id: string
          created_at?: string
          id?: string
          in_attendance_id?: string | null
          is_emergency?: boolean
          is_shortage?: boolean
          out_attendance_id?: string | null
          plan_run_id: string
          planned_relief_at: string
          reason?: Json
          score?: number | null
          slot_index?: number
          solver_version: string
          status?: string
          table_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          announce_at?: string | null
          assignment_id?: string | null
          club_id?: string
          created_at?: string
          id?: string
          in_attendance_id?: string | null
          is_emergency?: boolean
          is_shortage?: boolean
          out_attendance_id?: string | null
          plan_run_id?: string
          planned_relief_at?: string
          reason?: Json
          score?: number | null
          slot_index?: number
          solver_version?: string
          status?: string
          table_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dealer_rotation_schedule_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "dealer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_stuck_assignment_version_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_in_attendance_id_fkey"
            columns: ["in_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_in_attendance_id_fkey"
            columns: ["in_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_in_attendance_id_fkey"
            columns: ["in_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_out_attendance_id_fkey"
            columns: ["out_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_out_attendance_id_fkey"
            columns: ["out_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_out_attendance_id_fkey"
            columns: ["out_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_score_overrides: {
        Row: {
          created_at: string
          dealer_id: string
          score: number | null
          updated_at: string
          worked_hours: number | null
        }
        Insert: {
          created_at?: string
          dealer_id: string
          score?: number | null
          updated_at?: string
          worked_hours?: number | null
        }
        Update: {
          created_at?: string
          dealer_id?: string
          score?: number | null
          updated_at?: string
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_score_overrides_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: true
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_shifts: {
        Row: {
          club_id: string
          created_at: string
          end_time: string
          id: string
          start_time: string
          tour_name: string
          tour_tier: string | null
        }
        Insert: {
          club_id: string
          created_at?: string
          end_time: string
          id?: string
          start_time: string
          tour_name: string
          tour_tier?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          tour_name?: string
          tour_tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_shifts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_shifts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_skills: {
        Row: {
          certified_at: string
          certified_by: string | null
          dealer_id: string
          game_type: string
          id: string
        }
        Insert: {
          certified_at?: string
          certified_by?: string | null
          dealer_id: string
          game_type: string
          id?: string
        }
        Update: {
          certified_at?: string
          certified_by?: string | null
          dealer_id?: string
          game_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_skills_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_state_transitions: {
        Row: {
          attendance_id: string
          created_at: string
          from_state: string
          id: string
          reason: string | null
          to_state: string
        }
        Insert: {
          attendance_id: string
          created_at?: string
          from_state: string
          id?: string
          reason?: string | null
          to_state: string
        }
        Update: {
          attendance_id?: string
          created_at?: string
          from_state?: string
          id?: string
          reason?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_state_transitions_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_state_transitions_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_state_transitions_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
        ]
      }
      dealers: {
        Row: {
          base_rate_vnd: number | null
          club_id: string
          created_at: string
          deleted_at: string | null
          dependents_count: number
          employment_type: string
          full_name: string
          hired_date: string
          hourly_rate_vnd: number | null
          id: string
          joined_date: string | null
          monthly_salary_vnd: number | null
          notes: string | null
          ot_multiplier: number | null
          phone: string | null
          skills: string[]
          standard_hours_per_shift: number | null
          status: string
          telegram_user_id: number | null
          telegram_username: string | null
          tier: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          base_rate_vnd?: number | null
          club_id: string
          created_at?: string
          deleted_at?: string | null
          dependents_count?: number
          employment_type?: string
          full_name: string
          hired_date?: string
          hourly_rate_vnd?: number | null
          id?: string
          joined_date?: string | null
          monthly_salary_vnd?: number | null
          notes?: string | null
          ot_multiplier?: number | null
          phone?: string | null
          skills?: string[]
          standard_hours_per_shift?: number | null
          status?: string
          telegram_user_id?: number | null
          telegram_username?: string | null
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          base_rate_vnd?: number | null
          club_id?: string
          created_at?: string
          deleted_at?: string | null
          dependents_count?: number
          employment_type?: string
          full_name?: string
          hired_date?: string
          hourly_rate_vnd?: number | null
          id?: string
          joined_date?: string | null
          monthly_salary_vnd?: number | null
          notes?: string | null
          ot_multiplier?: number | null
          phone?: string | null
          skills?: string[]
          standard_hours_per_shift?: number | null
          status?: string
          telegram_user_id?: number | null
          telegram_username?: string | null
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_logs: {
        Row: {
          club_id: string | null
          created_at: string
          diagnostic_type: string
          id: string
          metadata: Json | null
          result: Json
          timestamp: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          diagnostic_type: string
          id?: string
          metadata?: Json | null
          result: Json
          timestamp?: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          diagnostic_type?: string
          id?: string
          metadata?: Json | null
          result?: Json
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_chats: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          user_a: string
          user_a_last_read_at: string
          user_b: string
          user_b_last_read_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          user_a: string
          user_a_last_read_at?: string
          user_b: string
          user_b_last_read_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          user_a?: string
          user_a_last_read_at?: string
          user_b?: string
          user_b_last_read_at?: string
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          kind: string
          sender_id: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          kind?: string
          sender_id: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "direct_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          duration_seconds: number | null
          file_url: string
          id: string
          is_public: boolean
          kind: string
          mime_type: string | null
          size_bytes: number | null
          subtitle_url: string | null
          tags: string[]
          thumbnail_url: string | null
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          file_url: string
          id?: string
          is_public?: boolean
          kind: string
          mime_type?: string | null
          size_bytes?: number | null
          subtitle_url?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          file_url?: string
          id?: string
          is_public?: boolean
          kind?: string
          mime_type?: string | null
          size_bytes?: number | null
          subtitle_url?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      escrow_funding_proofs: {
        Row: {
          amount_vnd: number | null
          bank_tx_id: string | null
          created_at: string
          deal_id: string
          id: string
          image_url: string
          note: string | null
          uploaded_by: string
        }
        Insert: {
          amount_vnd?: number | null
          bank_tx_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          image_url: string
          note?: string | null
          uploaded_by: string
        }
        Update: {
          amount_vnd?: number | null
          bank_tx_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          image_url?: string
          note?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "escrow_funding_proofs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      escrow_transactions: {
        Row: {
          amount_vnd: number
          bank_tx_id: string | null
          created_at: string
          deal_id: string
          id: string
          note: string | null
          performed_by_admin_id: string
          proof_image_url: string | null
          transaction_type: Database["public"]["Enums"]["escrow_tx_type"]
        }
        Insert: {
          amount_vnd: number
          bank_tx_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          note?: string | null
          performed_by_admin_id: string
          proof_image_url?: string | null
          transaction_type: Database["public"]["Enums"]["escrow_tx_type"]
        }
        Update: {
          amount_vnd?: number
          bank_tx_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          note?: string | null
          performed_by_admin_id?: string
          proof_image_url?: string | null
          transaction_type?: Database["public"]["Enums"]["escrow_tx_type"]
        }
        Relationships: [
          {
            foreignKeyName: "escrow_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      event_proofs: {
        Row: {
          caption: string | null
          created_at: string
          event_id: string
          id: string
          image_url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          event_id: string
          id?: string
          image_url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          event_id?: string
          id?: string
          image_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_proofs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "player_upcoming_events"
            referencedColumns: ["id"]
          },
        ]
      }
      game_tables: {
        Row: {
          club_id: string
          created_at: string
          current_blind_level: number
          down_count: number
          game_type: string
          id: string
          shift_id: string | null
          status: string
          table_name: string
          table_priority: number
          table_type: string
          tour_tier: string
        }
        Insert: {
          club_id: string
          created_at?: string
          current_blind_level?: number
          down_count?: number
          game_type?: string
          id?: string
          shift_id?: string | null
          status?: string
          table_name: string
          table_priority?: number
          table_type?: string
          tour_tier?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          current_blind_level?: number
          down_count?: number
          game_type?: string
          id?: string
          shift_id?: string | null
          status?: string
          table_name?: string
          table_priority?: number
          table_type?: string
          tour_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_tables_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_tables_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_tables_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "dealer_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      gto_app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      gto_ranges: {
        Row: {
          color: string | null
          created_at: string
          hands: string[]
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          hands?: string[]
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          hands?: string[]
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gto_spot_range_history: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string
          id: string
          note: string | null
          previous_range: Json | null
          range: Json
          spot_key: string
        }
        Insert: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          previous_range?: Json | null
          range: Json
          spot_key: string
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          previous_range?: Json | null
          range?: Json
          spot_key?: string
        }
        Relationships: []
      }
      gto_spot_ranges: {
        Row: {
          range: Json
          spot_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          range: Json
          spot_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          range?: Json
          spot_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      gto_user_spot_ranges: {
        Row: {
          created_at: string
          id: string
          range: Json
          spot_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          range: Json
          spot_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          range?: Json
          spot_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hand_actions: {
        Row: {
          action_amount: number | null
          action_order: number
          action_type: string
          created_at: string
          entry_number: number
          hand_id: string
          id: string
          player_id: string
          street: string | null
        }
        Insert: {
          action_amount?: number | null
          action_order: number
          action_type: string
          created_at?: string
          entry_number?: number
          hand_id: string
          id?: string
          player_id: string
          street?: string | null
        }
        Update: {
          action_amount?: number | null
          action_order?: number
          action_type?: string
          created_at?: string
          entry_number?: number
          hand_id?: string
          id?: string
          player_id?: string
          street?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hand_actions_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "tournament_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      hand_players: {
        Row: {
          created_at: string
          ending_stack: number | null
          entry_number: number
          hand_id: string
          hole_cards: Json | null
          id: string
          is_eliminated: boolean
          player_id: string
          seat_number: number
          side_pots: Json | null
          starting_stack: number
          tournament_id: string
        }
        Insert: {
          created_at?: string
          ending_stack?: number | null
          entry_number?: number
          hand_id: string
          hole_cards?: Json | null
          id?: string
          is_eliminated?: boolean
          player_id: string
          seat_number: number
          side_pots?: Json | null
          starting_stack: number
          tournament_id: string
        }
        Update: {
          created_at?: string
          ending_stack?: number | null
          entry_number?: number
          hand_id?: string
          hole_cards?: Json | null
          id?: string
          is_eliminated?: boolean
          player_id?: string
          seat_number?: number
          side_pots?: Json | null
          starting_stack?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hand_players_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "tournament_hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hand_players_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "hand_players_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      international_events: {
        Row: {
          buy_in_usd: number | null
          city: string | null
          country: string | null
          country_code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          end_date: string | null
          guarantee_usd: number | null
          id: string
          is_active: boolean
          name: string
          poster_url: string | null
          series: string | null
          start_date: string | null
          updated_at: string
          venue: string | null
          website_url: string | null
        }
        Insert: {
          buy_in_usd?: number | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          end_date?: string | null
          guarantee_usd?: number | null
          id?: string
          is_active?: boolean
          name: string
          poster_url?: string | null
          series?: string | null
          start_date?: string | null
          updated_at?: string
          venue?: string | null
          website_url?: string | null
        }
        Update: {
          buy_in_usd?: number | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          end_date?: string | null
          guarantee_usd?: number | null
          id?: string
          is_active?: boolean
          name?: string
          poster_url?: string | null
          series?: string | null
          start_date?: string | null
          updated_at?: string
          venue?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      leaderboard_entries: {
        Row: {
          cashout: number
          club_id: string | null
          created_at: string
          entry_date: string
          id: string
          notes: string | null
          player_id: string
          updated_at: string
          winnings: number
        }
        Insert: {
          cashout?: number
          club_id?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          notes?: string | null
          player_id: string
          updated_at?: string
          winnings?: number
        }
        Update: {
          cashout?: number
          club_id?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          notes?: string | null
          player_id?: string
          updated_at?: string
          winnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_entries_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_entries_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_verification_requests: {
        Row: {
          club_id: string
          created_at: string
          id: string
          member_card_id: string
          player_user_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          member_card_id: string
          player_user_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          member_card_id?: string
          player_user_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_verification_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_verification_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      news_posts: {
        Row: {
          author_id: string | null
          body: string | null
          cover_url: string | null
          created_at: string
          id: string
          is_featured: boolean
          published_at: string | null
          slug: string
          status: string
          summary: string | null
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_featured?: boolean
          published_at?: string | null
          slug: string
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string | null
          body?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_featured?: boolean
          published_at?: string | null
          slug?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          is_read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      online_poker_actions: {
        Row: {
          action: Json
          created_at: string
          hand_id: string
          id: string
          idempotency_key: string
          response: Json | null
          user_id: string
        }
        Insert: {
          action: Json
          created_at?: string
          hand_id: string
          id?: string
          idempotency_key: string
          response?: Json | null
          user_id: string
        }
        Update: {
          action?: Json
          created_at?: string
          hand_id?: string
          id?: string
          idempotency_key?: string
          response?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_actions_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_chip_ledger: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          hand_id: string | null
          id: string
          idempotency_key: string
          table_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          hand_id?: string | null
          id?: string
          idempotency_key: string
          table_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          hand_id?: string | null
          id?: string
          idempotency_key?: string
          table_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_chip_ledger_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_poker_chip_ledger_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "online_poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_config: {
        Row: {
          enabled: boolean
          id: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      online_poker_hand_events: {
        Row: {
          created_at: string
          event_seq: number
          hand_id: string
          payload: Json
          type: string
        }
        Insert: {
          created_at?: string
          event_seq: number
          hand_id: string
          payload?: Json
          type: string
        }
        Update: {
          created_at?: string
          event_seq?: number
          hand_id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_hand_events_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_hand_seats: {
        Row: {
          committed: number
          hand_id: string
          revealed_cards: Json | null
          seat_no: number
          stack: number
          starting_stack: number
          status: string
          total_committed: number
          user_id: string
        }
        Insert: {
          committed?: number
          hand_id: string
          revealed_cards?: Json | null
          seat_no: number
          stack: number
          starting_stack: number
          status?: string
          total_committed?: number
          user_id: string
        }
        Update: {
          committed?: number
          hand_id?: string
          revealed_cards?: Json | null
          seat_no?: number
          stack?: number
          starting_stack?: number
          status?: string
          total_committed?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_hand_seats_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_hand_secrets: {
        Row: {
          cards: Json | null
          created_at: string
          hand_id: string
          id: string
          kind: string
          seat_no: number | null
          server_seed: string | null
          server_seed_commit: string | null
        }
        Insert: {
          cards?: Json | null
          created_at?: string
          hand_id: string
          id?: string
          kind: string
          seat_no?: number | null
          server_seed?: string | null
          server_seed_commit?: string | null
        }
        Update: {
          cards?: Json | null
          created_at?: string
          hand_id?: string
          id?: string
          kind?: string
          seat_no?: number | null
          server_seed?: string | null
          server_seed_commit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_hand_secrets_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_hand_snapshots: {
        Row: {
          at_seq: number
          created_at: string
          hand_id: string
          schema_version: number
          state: Json
        }
        Insert: {
          at_seq: number
          created_at?: string
          hand_id: string
          schema_version?: number
          state: Json
        }
        Update: {
          at_seq?: number
          created_at?: string
          hand_id?: string
          schema_version?: number
          state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_hand_snapshots_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "online_poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_hands: {
        Row: {
          act_deadline: string | null
          board: Json
          button_seat: number | null
          created_at: string
          engine_version: string | null
          hand_no: number
          id: string
          pot: number
          shuffle_commit: string | null
          shuffle_reveal: string | null
          side_pots: Json
          state: Json
          state_schema_version: number
          state_version: number
          status: string
          street: string
          table_id: string
          to_act_seat: number | null
          updated_at: string
        }
        Insert: {
          act_deadline?: string | null
          board?: Json
          button_seat?: number | null
          created_at?: string
          engine_version?: string | null
          hand_no: number
          id?: string
          pot?: number
          shuffle_commit?: string | null
          shuffle_reveal?: string | null
          side_pots?: Json
          state?: Json
          state_schema_version?: number
          state_version?: number
          status?: string
          street?: string
          table_id: string
          to_act_seat?: number | null
          updated_at?: string
        }
        Update: {
          act_deadline?: string | null
          board?: Json
          button_seat?: number | null
          created_at?: string
          engine_version?: string | null
          hand_no?: number
          id?: string
          pot?: number
          shuffle_commit?: string | null
          shuffle_reveal?: string | null
          side_pots?: Json
          state?: Json
          state_schema_version?: number
          state_version?: number
          status?: string
          street?: string
          table_id?: string
          to_act_seat?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_hands_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "online_poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_player_accounts: {
        Row: {
          balance: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      online_poker_seats: {
        Row: {
          id: string
          joined_at: string
          seat_no: number
          stack: number
          status: string
          table_id: string
          user_id: string | null
        }
        Insert: {
          id?: string
          joined_at?: string
          seat_no: number
          stack?: number
          status?: string
          table_id: string
          user_id?: string | null
        }
        Update: {
          id?: string
          joined_at?: string
          seat_no?: number
          stack?: number
          status?: string
          table_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "online_poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      online_poker_tables: {
        Row: {
          act_timeout_secs: number
          bb: number
          club_id: string | null
          created_at: string
          created_by: string | null
          id: string
          max_buyin: number
          max_seats: number
          min_buyin: number
          name: string
          sb: number
          starting_stack_default: number
          status: string
        }
        Insert: {
          act_timeout_secs?: number
          bb: number
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          max_buyin: number
          max_seats?: number
          min_buyin: number
          name: string
          sb: number
          starting_stack_default: number
          status?: string
        }
        Update: {
          act_timeout_secs?: number
          bb?: number
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          max_buyin?: number
          max_seats?: number
          min_buyin?: number
          name?: string
          sb?: number
          starting_stack_default?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_poker_tables_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_poker_tables_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      package_tournaments: {
        Row: {
          created_at: string
          id: string
          package_id: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          package_id: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          id?: string
          package_id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_tournaments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "tournament_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          club_id: string
          created_at: string
          dealer_count: number
          id: string
          note: string | null
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_ref: string | null
          period_id: string
          prepared_at: string
          prepared_by: string
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_note: string | null
          reconciliation_ref: string | null
          status: string
          total_net_vnd: number
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          dealer_count?: number
          id?: string
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          period_id: string
          prepared_at?: string
          prepared_by: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_note?: string | null
          reconciliation_ref?: string | null
          status?: string
          total_net_vnd?: number
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          dealer_count?: number
          id?: string
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          period_id?: string
          prepared_at?: string
          prepared_by?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_note?: string | null
          reconciliation_ref?: string | null
          status?: string
          total_net_vnd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_recipients: {
        Row: {
          amount_vnd: number
          confirmed_at: string | null
          created_at: string
          deal_id: string
          id: string
          method: string
          paid_at: string | null
          platform_fee_vnd: number
          proof_image_url: string | null
          purchase_id: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          amount_vnd: number
          confirmed_at?: string | null
          created_at?: string
          deal_id: string
          id?: string
          method?: string
          paid_at?: string | null
          platform_fee_vnd?: number
          proof_image_url?: string | null
          purchase_id?: string | null
          role: string
          status?: string
          user_id: string
        }
        Update: {
          amount_vnd?: number
          confirmed_at?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          method?: string
          paid_at?: string | null
          platform_fee_vnd?: number
          proof_image_url?: string | null
          purchase_id?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_recipients_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_adjustments: {
        Row: {
          adjustment_type: string
          amount_vnd: number
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          payroll_id: string
          reason: string
          reference_id: string | null
        }
        Insert: {
          adjustment_type: string
          amount_vnd: number
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          payroll_id: string
          reason: string
          reference_id?: string | null
        }
        Update: {
          adjustment_type?: string
          amount_vnd?: number
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          payroll_id?: string
          reason?: string
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_adjustments_payroll_id_fkey"
            columns: ["payroll_id"]
            isOneToOne: false
            referencedRelation: "dealer_payroll"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_audit_log: {
        Row: {
          action: string
          changed_at: string | null
          changed_by: string | null
          club_id: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string | null
          club_id?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          club_id?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      payroll_calculation_log: {
        Row: {
          calculation_details: Json
          created_at: string | null
          id: string
          payroll_id: string
        }
        Insert: {
          calculation_details: Json
          created_at?: string | null
          id?: string
          payroll_id: string
        }
        Update: {
          calculation_details?: Json
          created_at?: string | null
          id?: string
          payroll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_calculation_log_payroll_id_fkey"
            columns: ["payroll_id"]
            isOneToOne: false
            referencedRelation: "dealer_payroll"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          calculated_by: string | null
          club_id: string
          created_at: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          paid_at: string | null
          paid_by: string | null
          payment_prepared_at: string | null
          payment_prepared_by: string | null
          period_end: string
          period_month: number
          period_start: string
          period_year: number
          reconciled_at: string | null
          reconciled_by: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string | null
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_by?: string | null
          club_id: string
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_prepared_at?: string | null
          payment_prepared_by?: string | null
          period_end: string
          period_month: number
          period_start: string
          period_year: number
          reconciled_at?: string | null
          reconciled_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_by?: string | null
          club_id?: string
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_prepared_at?: string | null
          payment_prepared_by?: string | null
          period_end?: string
          period_month?: number
          period_start?: string
          period_year?: number
          reconciled_at?: string | null
          reconciled_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_bank_accounts: {
        Row: {
          account_holder: string
          account_number: string
          account_type: string
          bank_name: string
          club_id: string | null
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          qr_code_url: string | null
          updated_at: string
        }
        Insert: {
          account_holder: string
          account_number: string
          account_type?: string
          bank_name: string
          club_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          qr_code_url?: string | null
          updated_at?: string
        }
        Update: {
          account_holder?: string
          account_number?: string
          account_type?: string
          bank_name?: string
          club_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          qr_code_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_bank_accounts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_bank_accounts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fee_config: {
        Row: {
          created_at: string
          fixed_fee: number
          id: string
          is_active: boolean
          max_buy_in: number
          min_buy_in: number
          percent_fee: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixed_fee: number
          id?: string
          is_active?: boolean
          max_buy_in: number
          min_buy_in: number
          percent_fee?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixed_fee?: number
          id?: string
          is_active?: boolean
          max_buy_in?: number
          min_buy_in?: number
          percent_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_results: {
        Row: {
          buy_in: number
          created_at: string
          event_date: string
          id: string
          player_id: string
          position: number | null
          prize: number
          proof_url: string | null
          total_entries: number | null
          tournament_name: string
          updated_at: string
          venue: string | null
          verified_by_admin: boolean
        }
        Insert: {
          buy_in?: number
          created_at?: string
          event_date: string
          id?: string
          player_id: string
          position?: number | null
          prize?: number
          proof_url?: string | null
          total_entries?: number | null
          tournament_name: string
          updated_at?: string
          venue?: string | null
          verified_by_admin?: boolean
        }
        Update: {
          buy_in?: number
          created_at?: string
          event_date?: string
          id?: string
          player_id?: string
          position?: number | null
          prize?: number
          proof_url?: string | null
          total_entries?: number | null
          tournament_name?: string
          updated_at?: string
          venue?: string | null
          verified_by_admin?: boolean
        }
        Relationships: []
      }
      player_stats: {
        Row: {
          avg_finish: number
          backing_description: string | null
          backing_percentage_available: number | null
          backing_review_note: string | null
          backing_reviewed_at: string | null
          backing_reviewed_by: string | null
          backing_status: Database["public"]["Enums"]["backing_review_status"]
          biggest_cash_amount: number
          biggest_cash_tournament_id: string | null
          created_at: string
          current_streak: number
          itm_rate: number
          last_20_results: Json
          looking_for_backing: boolean
          player_id: string
          roi_percentage: number
          total_profit_loss: number
          tournaments_cashed: number
          tournaments_played: number
          updated_at: string
          verified: boolean
        }
        Insert: {
          avg_finish?: number
          backing_description?: string | null
          backing_percentage_available?: number | null
          backing_review_note?: string | null
          backing_reviewed_at?: string | null
          backing_reviewed_by?: string | null
          backing_status?: Database["public"]["Enums"]["backing_review_status"]
          biggest_cash_amount?: number
          biggest_cash_tournament_id?: string | null
          created_at?: string
          current_streak?: number
          itm_rate?: number
          last_20_results?: Json
          looking_for_backing?: boolean
          player_id: string
          roi_percentage?: number
          total_profit_loss?: number
          tournaments_cashed?: number
          tournaments_played?: number
          updated_at?: string
          verified?: boolean
        }
        Update: {
          avg_finish?: number
          backing_description?: string | null
          backing_percentage_available?: number | null
          backing_review_note?: string | null
          backing_reviewed_at?: string | null
          backing_reviewed_by?: string | null
          backing_status?: Database["public"]["Enums"]["backing_review_status"]
          biggest_cash_amount?: number
          biggest_cash_tournament_id?: string | null
          created_at?: string
          current_streak?: number
          itm_rate?: number
          last_20_results?: Json
          looking_for_backing?: boolean
          player_id?: string
          roi_percentage?: number
          total_profit_loss?: number
          tournaments_cashed?: number
          tournaments_played?: number
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      player_upcoming_events: {
        Row: {
          buy_in: number
          cover_url: string | null
          created_at: string
          event_date: string
          event_name: string
          id: string
          markup: number
          notes: string | null
          player_id: string
          selling_percentage: number
          status: Database["public"]["Enums"]["upcoming_event_status"]
          tournament_id: string | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          buy_in?: number
          cover_url?: string | null
          created_at?: string
          event_date: string
          event_name: string
          id?: string
          markup?: number
          notes?: string | null
          player_id: string
          selling_percentage?: number
          status?: Database["public"]["Enums"]["upcoming_event_status"]
          tournament_id?: string | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          buy_in?: number
          cover_url?: string | null
          created_at?: string
          event_date?: string
          event_name?: string
          id?: string
          markup?: number
          notes?: string | null
          player_id?: string
          selling_percentage?: number
          status?: Database["public"]["Enums"]["upcoming_event_status"]
          tournament_id?: string | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      pre_announce_jobs: {
        Row: {
          assignment_id: string
          attempts: number
          attendance_id: string
          chat_id: string
          club_id: string
          created_at: string
          expires_at: string
          id: string
          in_dealer_name: string
          in_dealer_username: string | null
          last_attempt_at: string | null
          last_error: string | null
          max_attempts: number
          minutes_left: number
          out_attendance_id: string | null
          out_dealer_name: string | null
          out_dealer_username: string | null
          rest_deficit_min: number
          sent_at: string | null
          status: string
          swing_at: string
          table_id: string
          table_name: string
          updated_at: string
          zone: string | null
        }
        Insert: {
          assignment_id: string
          attempts?: number
          attendance_id: string
          chat_id: string
          club_id: string
          created_at?: string
          expires_at?: string
          id?: string
          in_dealer_name: string
          in_dealer_username?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          max_attempts?: number
          minutes_left: number
          out_attendance_id?: string | null
          out_dealer_name?: string | null
          out_dealer_username?: string | null
          rest_deficit_min?: number
          sent_at?: string | null
          status?: string
          swing_at: string
          table_id: string
          table_name: string
          updated_at?: string
          zone?: string | null
        }
        Update: {
          assignment_id?: string
          attempts?: number
          attendance_id?: string
          chat_id?: string
          club_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          in_dealer_name?: string
          in_dealer_username?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          max_attempts?: number
          minutes_left?: number
          out_attendance_id?: string | null
          out_dealer_name?: string | null
          out_dealer_username?: string | null
          rest_deficit_min?: number
          sent_at?: string | null
          status?: string
          swing_at?: string
          table_id?: string
          table_name?: string
          updated_at?: string
          zone?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_name: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          display_name_lower: string | null
          id: string
          is_verified: boolean
          onesignal_external_user_id: string | null
          phone: string | null
          rating_avg: number
          region: string | null
          total_deals: number
          updated_at: string
          user_id: string
          verification_status: string
          verified_at: string | null
          verified_by_club_id: string | null
          welcome_email_sent_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          display_name_lower?: string | null
          id?: string
          is_verified?: boolean
          onesignal_external_user_id?: string | null
          phone?: string | null
          rating_avg?: number
          region?: string | null
          total_deals?: number
          updated_at?: string
          user_id: string
          verification_status?: string
          verified_at?: string | null
          verified_by_club_id?: string | null
          welcome_email_sent_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          display_name_lower?: string | null
          id?: string
          is_verified?: boolean
          onesignal_external_user_id?: string | null
          phone?: string | null
          rating_avg?: number
          region?: string | null
          total_deals?: number
          updated_at?: string
          user_id?: string
          verification_status?: string
          verified_at?: string | null
          verified_by_club_id?: string | null
          welcome_email_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_verified_by_club_id_fkey"
            columns: ["verified_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_verified_by_club_id_fkey"
            columns: ["verified_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_assignment_history: {
        Row: {
          actor_user_id: string
          created_at: string
          draw_type: string
          entry_id: string
          from_seat_number: number | null
          from_table_id: string | null
          from_table_number: number | null
          id: string
          metadata: Json
          player_id: string
          reason: string
          to_seat_number: number
          to_table_id: string | null
          to_table_number: number | null
          tournament_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          draw_type: string
          entry_id: string
          from_seat_number?: number | null
          from_table_id?: string | null
          from_table_number?: number | null
          id?: string
          metadata?: Json
          player_id: string
          reason?: string
          to_seat_number: number
          to_table_id?: string | null
          to_table_number?: number | null
          tournament_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          draw_type?: string
          entry_id?: string
          from_seat_number?: number | null
          from_table_id?: string | null
          from_table_number?: number | null
          id?: string
          metadata?: Json
          player_id?: string
          reason?: string
          to_seat_number?: number
          to_table_id?: string | null
          to_table_number?: number | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_assignment_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "tournament_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_assignment_history_to_table_id_fkey"
            columns: ["to_table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_assignment_history_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "seat_assignment_history_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_draw_receipts: {
        Row: {
          cancelled_at: string | null
          display_name: string
          draw_type: string
          entry_id: string | null
          id: string
          issued_at: string
          issued_by: string | null
          player_id: string
          printed_at: string | null
          qr_payload: Json
          receipt_code: string
          registration_id: string | null
          seat_id: string | null
          seat_number: number
          status: string
          table_id: string | null
          table_number: number | null
          tournament_id: string
        }
        Insert: {
          cancelled_at?: string | null
          display_name: string
          draw_type: string
          entry_id?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          player_id: string
          printed_at?: string | null
          qr_payload?: Json
          receipt_code: string
          registration_id?: string | null
          seat_id?: string | null
          seat_number: number
          status?: string
          table_id?: string | null
          table_number?: number | null
          tournament_id: string
        }
        Update: {
          cancelled_at?: string | null
          display_name?: string
          draw_type?: string
          entry_id?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          player_id?: string
          printed_at?: string | null
          qr_payload?: Json
          receipt_code?: string
          registration_id?: string | null
          seat_id?: string | null
          seat_number?: number
          status?: string
          table_id?: string | null
          table_number?: number | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_draw_receipts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "tournament_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_draw_receipts_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "tournament_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_draw_receipts_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_draw_receipts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "seat_draw_receipts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      series_posts: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_url: string | null
          position: number
          series_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          position?: number
          series_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          position?: number
          series_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_posts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "tournament_series"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_break_policies: {
        Row: {
          break_pay_mode: string
          club_id: string
          created_at: string
          grace_minutes: number
          id: string
          max_break_time_variance_minutes: number
          max_work_before_mandatory_break_minutes: number
          min_work_before_break_minutes: number
          shift_type: string
          target_break_duration_minutes: number
          updated_at: string
        }
        Insert: {
          break_pay_mode?: string
          club_id: string
          created_at?: string
          grace_minutes?: number
          id?: string
          max_break_time_variance_minutes?: number
          max_work_before_mandatory_break_minutes?: number
          min_work_before_break_minutes?: number
          shift_type?: string
          target_break_duration_minutes?: number
          updated_at?: string
        }
        Update: {
          break_pay_mode?: string
          club_id?: string
          created_at?: string
          grace_minutes?: number
          id?: string
          max_break_time_variance_minutes?: number
          max_work_before_mandatory_break_minutes?: number
          min_work_before_break_minutes?: number
          shift_type?: string
          target_break_duration_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_break_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_break_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      special_dates: {
        Row: {
          club_id: string
          created_at: string
          date: string
          id: string
          label: string | null
          multiplier: number
        }
        Insert: {
          club_id: string
          created_at?: string
          date: string
          id?: string
          label?: string | null
          multiplier?: number
        }
        Update: {
          club_id?: string
          created_at?: string
          date?: string
          id?: string
          label?: string | null
          multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "special_dates_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_dates_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      stack_registrations: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          created_at: string
          id: string
          note: string | null
          status: Database["public"]["Enums"]["registration_status"]
          tournament_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          tournament_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          tournament_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staking_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["staking_audit_action"]
          created_at: string
          deal_id: string | null
          id: string
          metadata: Json | null
          new_status: string | null
          old_status: string | null
          performed_by: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["staking_audit_action"]
          created_at?: string
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          new_status?: string | null
          old_status?: string | null
          performed_by?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["staking_audit_action"]
          created_at?: string
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          new_status?: string | null
          old_status?: string | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staking_audit_logs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      staking_deals: {
        Row: {
          admin_override_approved: boolean
          admin_override_reason: string | null
          admin_review_note: string | null
          admin_review_status: Database["public"]["Enums"]["staking_admin_review_status"]
          asking_price_vnd: number
          backer_confirmed_release: boolean
          backer_id: string | null
          backer_payout_vnd: number | null
          buy_in_amount_vnd: number
          cancellation_reason: string | null
          club_id: string | null
          committed_at: string | null
          completed_at: string | null
          created_at: string
          custom_event_date: string | null
          custom_event_name: string | null
          custom_event_venue: string | null
          description: string | null
          dispute_reason: string | null
          early_closed: boolean
          early_closed_at: string | null
          escrow_amount_vnd: number
          escrow_bank_reference: string
          escrow_contract_address: string | null
          escrow_locked_at: string | null
          escrow_type: Database["public"]["Enums"]["escrow_type"]
          filled_percent: number
          id: string
          markup: number
          min_purchase_percent: number
          override_data: Json | null
          percentage_sold: number
          placement: string | null
          platform_archive_fee: number
          platform_fee_vnd: number | null
          platform_fixed_fee: number
          platform_percent_fee: number
          player_checked_in: boolean
          player_checkin_at: string | null
          player_confirmed_release: boolean
          player_id: string
          player_payout_vnd: number | null
          registration_deadline: string | null
          release_condition_type: Database["public"]["Enums"]["release_condition_type"]
          result_data: Json | null
          result_entered_at: string | null
          result_entered_by: string | null
          result_prize_vnd: number | null
          result_proof_url: string | null
          result_verified_at: string | null
          result_verified_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["staking_deal_status"]
          tournament_id: string | null
          transfer_proof_image_url: string | null
          transfer_proof_submitted: boolean
          updated_at: string
        }
        Insert: {
          admin_override_approved?: boolean
          admin_override_reason?: string | null
          admin_review_note?: string | null
          admin_review_status?: Database["public"]["Enums"]["staking_admin_review_status"]
          asking_price_vnd?: number
          backer_confirmed_release?: boolean
          backer_id?: string | null
          backer_payout_vnd?: number | null
          buy_in_amount_vnd: number
          cancellation_reason?: string | null
          club_id?: string | null
          committed_at?: string | null
          completed_at?: string | null
          created_at?: string
          custom_event_date?: string | null
          custom_event_name?: string | null
          custom_event_venue?: string | null
          description?: string | null
          dispute_reason?: string | null
          early_closed?: boolean
          early_closed_at?: string | null
          escrow_amount_vnd?: number
          escrow_bank_reference?: string
          escrow_contract_address?: string | null
          escrow_locked_at?: string | null
          escrow_type?: Database["public"]["Enums"]["escrow_type"]
          filled_percent?: number
          id?: string
          markup: number
          min_purchase_percent?: number
          override_data?: Json | null
          percentage_sold: number
          placement?: string | null
          platform_archive_fee?: number
          platform_fee_vnd?: number | null
          platform_fixed_fee?: number
          platform_percent_fee?: number
          player_checked_in?: boolean
          player_checkin_at?: string | null
          player_confirmed_release?: boolean
          player_id: string
          player_payout_vnd?: number | null
          registration_deadline?: string | null
          release_condition_type?: Database["public"]["Enums"]["release_condition_type"]
          result_data?: Json | null
          result_entered_at?: string | null
          result_entered_by?: string | null
          result_prize_vnd?: number | null
          result_proof_url?: string | null
          result_verified_at?: string | null
          result_verified_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["staking_deal_status"]
          tournament_id?: string | null
          transfer_proof_image_url?: string | null
          transfer_proof_submitted?: boolean
          updated_at?: string
        }
        Update: {
          admin_override_approved?: boolean
          admin_override_reason?: string | null
          admin_review_note?: string | null
          admin_review_status?: Database["public"]["Enums"]["staking_admin_review_status"]
          asking_price_vnd?: number
          backer_confirmed_release?: boolean
          backer_id?: string | null
          backer_payout_vnd?: number | null
          buy_in_amount_vnd?: number
          cancellation_reason?: string | null
          club_id?: string | null
          committed_at?: string | null
          completed_at?: string | null
          created_at?: string
          custom_event_date?: string | null
          custom_event_name?: string | null
          custom_event_venue?: string | null
          description?: string | null
          dispute_reason?: string | null
          early_closed?: boolean
          early_closed_at?: string | null
          escrow_amount_vnd?: number
          escrow_bank_reference?: string
          escrow_contract_address?: string | null
          escrow_locked_at?: string | null
          escrow_type?: Database["public"]["Enums"]["escrow_type"]
          filled_percent?: number
          id?: string
          markup?: number
          min_purchase_percent?: number
          override_data?: Json | null
          percentage_sold?: number
          placement?: string | null
          platform_archive_fee?: number
          platform_fee_vnd?: number | null
          platform_fixed_fee?: number
          platform_percent_fee?: number
          player_checked_in?: boolean
          player_checkin_at?: string | null
          player_confirmed_release?: boolean
          player_id?: string
          player_payout_vnd?: number | null
          registration_deadline?: string | null
          release_condition_type?: Database["public"]["Enums"]["release_condition_type"]
          result_data?: Json | null
          result_entered_at?: string | null
          result_entered_by?: string | null
          result_prize_vnd?: number | null
          result_proof_url?: string | null
          result_verified_at?: string | null
          result_verified_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["staking_deal_status"]
          tournament_id?: string | null
          transfer_proof_image_url?: string | null
          transfer_proof_submitted?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staking_deals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staking_deals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      staking_ledger: {
        Row: {
          amount_vnd: number
          created_at: string
          deal_id: string
          entry_type: string
          id: string
          metadata: Json | null
          payout_method: string | null
          performed_by: string
          proof_url: string | null
          release_request_id: string | null
          tx_hash: string | null
          usdt_amount: number | null
          user_id: string | null
        }
        Insert: {
          amount_vnd: number
          created_at?: string
          deal_id: string
          entry_type: string
          id?: string
          metadata?: Json | null
          payout_method?: string | null
          performed_by: string
          proof_url?: string | null
          release_request_id?: string | null
          tx_hash?: string | null
          usdt_amount?: number | null
          user_id?: string | null
        }
        Update: {
          amount_vnd?: number
          created_at?: string
          deal_id?: string
          entry_type?: string
          id?: string
          metadata?: Json | null
          payout_method?: string | null
          performed_by?: string
          proof_url?: string | null
          release_request_id?: string | null
          tx_hash?: string | null
          usdt_amount?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      staking_purchases: {
        Row: {
          amount_vnd: number
          backer_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          committed_at: string
          created_at: string
          deal_id: string
          funded_at: string | null
          id: string
          markup: number
          percent: number
          reference_code: string
          status: string
          transfer_proof_submitted: boolean
          transfer_proof_url: string | null
          updated_at: string
        }
        Insert: {
          amount_vnd: number
          backer_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          committed_at?: string
          created_at?: string
          deal_id: string
          funded_at?: string | null
          id?: string
          markup: number
          percent: number
          reference_code: string
          status?: string
          transfer_proof_submitted?: boolean
          transfer_proof_url?: string | null
          updated_at?: string
        }
        Update: {
          amount_vnd?: number
          backer_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          committed_at?: string
          created_at?: string
          deal_id?: string
          funded_at?: string | null
          id?: string
          markup?: number
          percent?: number
          reference_code?: string
          status?: string
          transfer_proof_submitted?: boolean
          transfer_proof_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staking_purchases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      staking_release_requests: {
        Row: {
          cosigned_at: string | null
          cosigned_by_admin_id: string | null
          deal_id: string
          executed_at: string | null
          id: string
          note: string | null
          requested_at: string
          requested_by_admin_id: string
          status: Database["public"]["Enums"]["release_request_status"]
        }
        Insert: {
          cosigned_at?: string | null
          cosigned_by_admin_id?: string | null
          deal_id: string
          executed_at?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requested_by_admin_id: string
          status?: Database["public"]["Enums"]["release_request_status"]
        }
        Update: {
          cosigned_at?: string | null
          cosigned_by_admin_id?: string | null
          deal_id?: string
          executed_at?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requested_by_admin_id?: string
          status?: Database["public"]["Enums"]["release_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "staking_release_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "staking_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          tournament_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          tournament_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          tournament_id?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          attachment_url: string | null
          body: string
          created_at: string
          id: string
          is_internal: boolean
          sender_id: string
          ticket_id: string
        }
        Insert: {
          attachment_url?: string | null
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sender_id: string
          ticket_id: string
        }
        Update: {
          attachment_url?: string | null
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          content: string
          created_at: string
          id: string
          resolution_note: string | null
          resolved_at: string | null
          status: string
          subject: string | null
          ticket_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          content: string
          created_at?: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string | null
          ticket_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          content?: string
          created_at?: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string | null
          ticket_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      swing_audit_logs: {
        Row: {
          action: string
          assignment_id: string | null
          club_id: string
          created_at: string
          details: Json | null
          error_message: string | null
          id: string
          new_dealer_id: string | null
          old_dealer_id: string | null
          shift_id: string | null
          table_id: string | null
          triggered_by: string
        }
        Insert: {
          action: string
          assignment_id?: string | null
          club_id: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          new_dealer_id?: string | null
          old_dealer_id?: string | null
          shift_id?: string | null
          table_id?: string | null
          triggered_by?: string
        }
        Update: {
          action?: string
          assignment_id?: string | null
          club_id?: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          new_dealer_id?: string | null
          old_dealer_id?: string | null
          shift_id?: string | null
          table_id?: string | null
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "swing_audit_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "dealer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_stuck_assignment_version_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_new_dealer_id_fkey"
            columns: ["new_dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_old_dealer_id_fkey"
            columns: ["old_dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "dealer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_audit_logs_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      swing_config: {
        Row: {
          auto_adjust_duration: boolean
          base_duration_minutes: number
          break_duration_minutes: number
          break_return_policy: string
          club_id: string
          club_zone: string | null
          crit_at_minutes: number
          id: string
          max_duration_minutes: number
          min_duration_minutes: number
          min_inter_swing_rest_minutes: number
          minimum_break_duration_minutes: number
          overtime_threshold_minutes: number | null
          pre_announce_minutes: number
          pre_notify_minutes: number
          rotation_planner_enabled: boolean | null
          swing_duration_minutes: number
          table_type: string
          target_ratio: number
          tier_a_min_buyin: number
          tier_b_min_buyin: number
          tournament_mode: string
          warn_at_minutes: number
        }
        Insert: {
          auto_adjust_duration?: boolean
          base_duration_minutes?: number
          break_duration_minutes?: number
          break_return_policy?: string
          club_id: string
          club_zone?: string | null
          crit_at_minutes?: number
          id?: string
          max_duration_minutes?: number
          min_duration_minutes?: number
          min_inter_swing_rest_minutes?: number
          minimum_break_duration_minutes?: number
          overtime_threshold_minutes?: number | null
          pre_announce_minutes?: number
          pre_notify_minutes?: number
          rotation_planner_enabled?: boolean | null
          swing_duration_minutes?: number
          table_type: string
          target_ratio?: number
          tier_a_min_buyin?: number
          tier_b_min_buyin?: number
          tournament_mode?: string
          warn_at_minutes?: number
        }
        Update: {
          auto_adjust_duration?: boolean
          base_duration_minutes?: number
          break_duration_minutes?: number
          break_return_policy?: string
          club_id?: string
          club_zone?: string | null
          crit_at_minutes?: number
          id?: string
          max_duration_minutes?: number
          min_duration_minutes?: number
          min_inter_swing_rest_minutes?: number
          minimum_break_duration_minutes?: number
          overtime_threshold_minutes?: number | null
          pre_announce_minutes?: number
          pre_notify_minutes?: number
          rotation_planner_enabled?: boolean | null
          swing_duration_minutes?: number
          table_type?: string
          target_ratio?: number
          tier_a_min_buyin?: number
          tier_b_min_buyin?: number
          tournament_mode?: string
          warn_at_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "swing_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      swing_config_audit: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          club_id: string
          entity_id: string | null
          entity_type: string
          id: string
          new_values: Json | null
          old_values: Json | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          club_id: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          club_id?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "swing_config_audit_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_config_audit_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      swing_configs: {
        Row: {
          club_id: string
          created_at: string | null
          crit_at_minutes: number
          id: string
          scope_id: string | null
          scope_type: string
          swing_duration_minutes: number
          updated_at: string | null
          warn_at_minutes: number
        }
        Insert: {
          club_id: string
          created_at?: string | null
          crit_at_minutes?: number
          id?: string
          scope_id?: string | null
          scope_type: string
          swing_duration_minutes: number
          updated_at?: string | null
          warn_at_minutes?: number
        }
        Update: {
          club_id?: string
          created_at?: string | null
          crit_at_minutes?: number
          id?: string
          scope_id?: string | null
          scope_type?: string
          swing_duration_minutes?: number
          updated_at?: string | null
          warn_at_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "swing_configs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_configs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      swing_escalation_config: {
        Row: {
          audit_enabled_min_overdue_min: number
          audit_max_rows: number
          club_id: string
          created_at: string
          force_release_at_overdue_min: number
          tier_1_min_overdue_min: number
          tier_1_min_rest_min: number
          tier_2_min_overdue_min: number
          tier_2_min_rest_min: number
          tier_2_skip_priority_break: boolean
          tier_3_min_overdue_min: number
          tier_3_min_rest_min: number
          tier_3_skip_fatigue_cap: boolean
          updated_at: string
        }
        Insert: {
          audit_enabled_min_overdue_min?: number
          audit_max_rows?: number
          club_id: string
          created_at?: string
          force_release_at_overdue_min?: number
          tier_1_min_overdue_min?: number
          tier_1_min_rest_min?: number
          tier_2_min_overdue_min?: number
          tier_2_min_rest_min?: number
          tier_2_skip_priority_break?: boolean
          tier_3_min_overdue_min?: number
          tier_3_min_rest_min?: number
          tier_3_skip_fatigue_cap?: boolean
          updated_at?: string
        }
        Update: {
          audit_enabled_min_overdue_min?: number
          audit_max_rows?: number
          club_id?: string
          created_at?: string
          force_release_at_overdue_min?: number
          tier_1_min_overdue_min?: number
          tier_1_min_rest_min?: number
          tier_2_min_overdue_min?: number
          tier_2_min_rest_min?: number
          tier_2_skip_priority_break?: boolean
          tier_3_min_overdue_min?: number
          tier_3_min_rest_min?: number
          tier_3_skip_fatigue_cap?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "swing_escalation_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_escalation_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      swing_log: {
        Row: {
          assignment_id: string
          club_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          outcome: string
          table_id: string | null
          triggered_by: string | null
        }
        Insert: {
          assignment_id: string
          club_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          outcome: string
          table_id?: string | null
          triggered_by?: string | null
        }
        Update: {
          assignment_id?: string
          club_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string
          table_id?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      swing_metrics: {
        Row: {
          avg_processing_time_ms: number | null
          club_id: string
          date: string
          failed_swings: number | null
          id: string
          no_dealer_swings: number | null
          skipped_swings: number
          successful_swings: number | null
          telegram_failures: number | null
          total_swings: number | null
        }
        Insert: {
          avg_processing_time_ms?: number | null
          club_id: string
          date: string
          failed_swings?: number | null
          id?: string
          no_dealer_swings?: number | null
          skipped_swings?: number
          successful_swings?: number | null
          telegram_failures?: number | null
          total_swings?: number | null
        }
        Update: {
          avg_processing_time_ms?: number | null
          club_id?: string
          date?: string
          failed_swings?: number | null
          id?: string
          no_dealer_swings?: number | null
          skipped_swings?: number
          successful_swings?: number | null
          telegram_failures?: number | null
          total_swings?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "swing_metrics_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_metrics_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          club_id: string
          created_at: string
          error_sample: Json | null
          id: string
          records_failed: number
          records_inserted: number
          records_updated: number
          source_type: string
          synced_by: string
        }
        Insert: {
          club_id: string
          created_at?: string
          error_sample?: Json | null
          id?: string
          records_failed?: number
          records_inserted?: number
          records_updated?: number
          source_type?: string
          synced_by: string
        }
        Update: {
          club_id?: string
          created_at?: string
          error_sample?: Json | null
          id?: string
          records_failed?: number
          records_inserted?: number
          records_updated?: number
          source_type?: string
          synced_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_chip_counts: {
        Row: {
          chip_count: number
          entry_number: number
          id: string
          player_id: string
          tournament_id: string
          updated_at: string
        }
        Insert: {
          chip_count?: number
          entry_number?: number
          id?: string
          player_id: string
          tournament_id: string
          updated_at?: string
        }
        Update: {
          chip_count?: number
          entry_number?: number
          id?: string
          player_id?: string
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_chip_counts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_chip_counts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_eliminations: {
        Row: {
          created_at: string
          entry_number: number
          hand_id: string
          id: string
          player_id: string
          position: number
          prize: number | null
          tournament_id: string
        }
        Insert: {
          created_at?: string
          entry_number?: number
          hand_id: string
          id?: string
          player_id: string
          position: number
          prize?: number | null
          tournament_id: string
        }
        Update: {
          created_at?: string
          entry_number?: number
          hand_id?: string
          id?: string
          player_id?: string
          position?: number
          prize?: number | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_eliminations_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "tournament_hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_eliminations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_eliminations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_entries: {
        Row: {
          busted_at: string | null
          checked_in_at: string | null
          created_at: string
          current_stack: number
          entry_no: number
          finished_place: number | null
          id: string
          player_id: string
          registration_id: string | null
          seat_id: string | null
          seat_number: number | null
          seated_at: string | null
          source: string
          status: string
          table_id: string | null
          tournament_id: string
          updated_at: string
        }
        Insert: {
          busted_at?: string | null
          checked_in_at?: string | null
          created_at?: string
          current_stack?: number
          entry_no: number
          finished_place?: number | null
          id?: string
          player_id: string
          registration_id?: string | null
          seat_id?: string | null
          seat_number?: number | null
          seated_at?: string | null
          source?: string
          status?: string
          table_id?: string | null
          tournament_id: string
          updated_at?: string
        }
        Update: {
          busted_at?: string | null
          checked_in_at?: string | null
          created_at?: string
          current_stack?: number
          entry_no?: number
          finished_place?: number | null
          id?: string
          player_id?: string
          registration_id?: string | null
          seat_id?: string | null
          seat_number?: number | null
          seated_at?: string | null
          source?: string
          status?: string
          table_id?: string | null
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_entries_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "tournament_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_entries_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_hand_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          details: Json | null
          hand_id: string
          id: string
          new_status: string | null
          old_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          hand_id: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          hand_id?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_hand_audit_log_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "tournament_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_hands: {
        Row: {
          button_seat: number
          community_cards: Json | null
          created_at: string
          created_by: string | null
          hand_number: number
          hand_time: string
          id: string
          is_voided: boolean | null
          locked_at: string | null
          locked_by_user_id: string | null
          pot_size: number | null
          side_pots: Json | null
          status: string
          table_id: string
          tournament_id: string
          updated_at: string | null
        }
        Insert: {
          button_seat?: number
          community_cards?: Json | null
          created_at?: string
          created_by?: string | null
          hand_number: number
          hand_time?: string
          id?: string
          is_voided?: boolean | null
          locked_at?: string | null
          locked_by_user_id?: string | null
          pot_size?: number | null
          side_pots?: Json | null
          status?: string
          table_id: string
          tournament_id: string
          updated_at?: string | null
        }
        Update: {
          button_seat?: number
          community_cards?: Json | null
          created_at?: string
          created_by?: string | null
          hand_number?: number
          hand_time?: string
          id?: string
          is_voided?: boolean | null
          locked_at?: string | null
          locked_by_user_id?: string | null
          pot_size?: number | null
          side_pots?: Json | null
          status?: string
          table_id?: string
          tournament_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_hands_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tournament_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_hands_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_hands_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_levels: {
        Row: {
          ante: number
          big_blind: number
          created_at: string
          duration_minutes: number
          id: string
          is_break: boolean
          level_number: number
          small_blind: number
          tournament_id: string
        }
        Insert: {
          ante?: number
          big_blind?: number
          created_at?: string
          duration_minutes?: number
          id?: string
          is_break?: boolean
          level_number: number
          small_blind?: number
          tournament_id: string
        }
        Update: {
          ante?: number
          big_blind?: number
          created_at?: string
          duration_minutes?: number
          id?: string
          is_break?: boolean
          level_number?: number
          small_blind?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_levels_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_levels_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_packages: {
        Row: {
          benefits: Json
          created_at: string
          description: string | null
          description_en: string | null
          early_bird_end: string | null
          id: string
          image_url: string | null
          max_participants: number | null
          name: string
          name_en: string
          original_price_vnd: number | null
          price_vnd: number
          registered_count: number
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          benefits?: Json
          created_at?: string
          description?: string | null
          description_en?: string | null
          early_bird_end?: string | null
          id?: string
          image_url?: string | null
          max_participants?: number | null
          name: string
          name_en?: string
          original_price_vnd?: number | null
          price_vnd: number
          registered_count?: number
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          benefits?: Json
          created_at?: string
          description?: string | null
          description_en?: string | null
          early_bird_end?: string | null
          id?: string
          image_url?: string | null
          max_participants?: number | null
          name?: string
          name_en?: string
          original_price_vnd?: number | null
          price_vnd?: number
          registered_count?: number
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tournament_prizes: {
        Row: {
          amount: number
          created_at: string
          id: string
          percentage: number
          position: number
          tournament_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          percentage: number
          position: number
          tournament_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          percentage?: number
          position?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_prizes_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_prizes_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_registrations: {
        Row: {
          buy_in: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          club_id: string | null
          committed_at: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          platform_fixed_fee: number
          player_id: string
          reference_code: string
          status: string
          total_pay: number
          tournament_id: string
          transfer_proof_image_url: string | null
          transfer_proof_submitted: boolean
          updated_at: string
        }
        Insert: {
          buy_in: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          club_id?: string | null
          committed_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          platform_fixed_fee?: number
          player_id: string
          reference_code: string
          status?: string
          total_pay?: number
          tournament_id: string
          transfer_proof_image_url?: string | null
          transfer_proof_submitted?: boolean
          updated_at?: string
        }
        Update: {
          buy_in?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          club_id?: string | null
          committed_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          platform_fixed_fee?: number
          player_id?: string
          reference_code?: string
          status?: string
          total_pay?: number
          tournament_id?: string
          transfer_proof_image_url?: string | null
          transfer_proof_submitted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      tournament_seats: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          chip_count: number
          created_at: string
          entry_id: string | null
          entry_number: number
          id: string
          is_active: boolean
          player_id: string
          player_name: string
          reserved_until: string | null
          seat_number: number
          status: string
          table_id: string
          tournament_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          chip_count?: number
          created_at?: string
          entry_id?: string | null
          entry_number?: number
          id?: string
          is_active?: boolean
          player_id?: string
          player_name?: string
          reserved_until?: string | null
          seat_number: number
          status?: string
          table_id: string
          tournament_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          chip_count?: number
          created_at?: string
          entry_id?: string | null
          entry_number?: number
          id?: string
          is_active?: boolean
          player_id?: string
          player_name?: string
          reserved_until?: string | null
          seat_number?: number
          status?: string
          table_id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tournament_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_seats_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_seats_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_series: {
        Row: {
          club_id: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          end_date: string
          id: string
          location: string | null
          name: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          club_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_date: string
          id?: string
          location?: string | null
          name: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          club_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          location?: string | null
          name?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_series_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_series_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_state_transitions: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_state: string
          previous_state: string
          reason: string | null
          tournament_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_state: string
          previous_state: string
          reason?: string | null
          tournament_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_state?: string
          previous_state?: string
          reason?: string | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_state_transitions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_state_transitions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_streams: {
        Row: {
          created_at: string
          created_by: string | null
          custom_tournament_name: string | null
          embed_id: string | null
          id: string
          is_live: boolean
          match_title: string | null
          platform: string
          scheduled_at: string | null
          stream_url: string
          thumbnail_url: string | null
          title: string | null
          tournament_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_tournament_name?: string | null
          embed_id?: string | null
          id?: string
          is_live?: boolean
          match_title?: string | null
          platform: string
          scheduled_at?: string | null
          stream_url: string
          thumbnail_url?: string | null
          title?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_tournament_name?: string | null
          embed_id?: string | null
          id?: string
          is_live?: boolean
          match_title?: string | null
          platform?: string
          scheduled_at?: string | null
          stream_url?: string
          thumbnail_url?: string | null
          title?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tournament_tables: {
        Row: {
          created_at: string | null
          id: string
          max_seats: number
          status: string
          table_id: string | null
          table_name: string
          table_number: number | null
          tournament_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_seats?: number
          status?: string
          table_id?: string | null
          table_name?: string
          table_number?: number | null
          tournament_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          max_seats?: number
          status?: string
          table_id?: string | null
          table_name?: string
          table_number?: number | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_tables_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_tables_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tournament_tables_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          average_stack: number | null
          buy_in: number
          clock_paused_at: string | null
          clock_started_at: string | null
          club_id: string
          created_at: string | null
          crit_at_minutes: number
          current_blinds: string | null
          current_level: number | null
          current_level_id: string | null
          current_players: number | null
          deleted_at: string | null
          description: string | null
          free_rake_enabled: boolean | null
          free_rake_slots: number | null
          free_rake_used: number | null
          game_type: string
          id: string
          itm_places: number | null
          late_reg_close_level: number | null
          live_status: string | null
          location: string | null
          minutes_per_level: number
          name: string
          pause_accumulated: number | null
          players_remaining: number | null
          prize_pool: number | null
          rake_amount: number
          service_fee_amount: number
          start_time: string | null
          starting_stack: number
          status: string
          swing_duration_minutes: number
          updated_at: string | null
          warn_at_minutes: number
        }
        Insert: {
          average_stack?: number | null
          buy_in?: number
          clock_paused_at?: string | null
          clock_started_at?: string | null
          club_id: string
          created_at?: string | null
          crit_at_minutes?: number
          current_blinds?: string | null
          current_level?: number | null
          current_level_id?: string | null
          current_players?: number | null
          deleted_at?: string | null
          description?: string | null
          free_rake_enabled?: boolean | null
          free_rake_slots?: number | null
          free_rake_used?: number | null
          game_type?: string
          id?: string
          itm_places?: number | null
          late_reg_close_level?: number | null
          live_status?: string | null
          location?: string | null
          minutes_per_level?: number
          name: string
          pause_accumulated?: number | null
          players_remaining?: number | null
          prize_pool?: number | null
          rake_amount?: number
          service_fee_amount?: number
          start_time?: string | null
          starting_stack?: number
          status?: string
          swing_duration_minutes?: number
          updated_at?: string | null
          warn_at_minutes?: number
        }
        Update: {
          average_stack?: number | null
          buy_in?: number
          clock_paused_at?: string | null
          clock_started_at?: string | null
          club_id?: string
          created_at?: string | null
          crit_at_minutes?: number
          current_blinds?: string | null
          current_level?: number | null
          current_level_id?: string | null
          current_players?: number | null
          deleted_at?: string | null
          description?: string | null
          free_rake_enabled?: boolean | null
          free_rake_slots?: number | null
          free_rake_used?: number | null
          game_type?: string
          id?: string
          itm_places?: number | null
          late_reg_close_level?: number | null
          live_status?: string | null
          location?: string | null
          minutes_per_level?: number
          name?: string
          pause_accumulated?: number | null
          players_remaining?: number | null
          prize_pool?: number | null
          rake_amount?: number
          service_fee_amount?: number
          start_time?: string | null
          starting_stack?: number
          status?: string
          swing_duration_minutes?: number
          updated_at?: string | null
          warn_at_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tv_displays: {
        Row: {
          announcement: string | null
          assigned_tournament_id: string | null
          claimed_by: string | null
          club_id: string | null
          created_at: string
          display_number: number | null
          display_token: string
          id: string
          last_seen_at: string | null
          layout: string
          name: string | null
          pair_code: string | null
          pair_code_expires_at: string | null
          paired_at: string | null
          revoked_at: string | null
          status: string
          theme: string
          updated_at: string
          zone: string | null
        }
        Insert: {
          announcement?: string | null
          assigned_tournament_id?: string | null
          claimed_by?: string | null
          club_id?: string | null
          created_at?: string
          display_number?: number | null
          display_token: string
          id?: string
          last_seen_at?: string | null
          layout?: string
          name?: string | null
          pair_code?: string | null
          pair_code_expires_at?: string | null
          paired_at?: string | null
          revoked_at?: string | null
          status?: string
          theme?: string
          updated_at?: string
          zone?: string | null
        }
        Update: {
          announcement?: string | null
          assigned_tournament_id?: string | null
          claimed_by?: string | null
          club_id?: string | null
          created_at?: string
          display_number?: number | null
          display_token?: string
          id?: string
          last_seen_at?: string | null
          layout?: string
          name?: string | null
          pair_code?: string | null
          pair_code_expires_at?: string | null
          paired_at?: string | null
          revoked_at?: string | null
          status?: string
          theme?: string
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tv_displays_assigned_tournament_id_fkey"
            columns: ["assigned_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament_leaderboard_view"
            referencedColumns: ["tournament_id"]
          },
          {
            foreignKeyName: "tv_displays_assigned_tournament_id_fkey"
            columns: ["assigned_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tv_displays_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tv_displays_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      usdt_exchange_rates: {
        Row: {
          buy_rate: number | null
          created_at: string
          effective_from: string
          effective_until: string | null
          id: string
          is_active: boolean
          note: string | null
          rate_vnd_per_usdt: number
          set_by: string | null
          spread_percent: number
        }
        Insert: {
          buy_rate?: number | null
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          is_active?: boolean
          note?: string | null
          rate_vnd_per_usdt: number
          set_by?: string | null
          spread_percent?: number
        }
        Update: {
          buy_rate?: number | null
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          is_active?: boolean
          note?: string | null
          rate_vnd_per_usdt?: number
          set_by?: string | null
          spread_percent?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      web_vitals_events: {
        Row: {
          created_at: string
          delta: number | null
          id: string
          metric_id: string
          metric_name: string
          metric_value: number
          navigation_type: string | null
          page: string | null
          rating: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          delta?: number | null
          id?: string
          metric_id: string
          metric_name: string
          metric_value: number
          navigation_type?: string | null
          page?: string | null
          rating?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          delta?: number | null
          id?: string
          metric_id?: string
          metric_name?: string
          metric_value?: number
          navigation_type?: string | null
          page?: string | null
          rating?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      clubs_public: {
        Row: {
          address: string | null
          cover_url: string | null
          created_at: string | null
          description: string | null
          id: string | null
          name: string | null
          owner_id: string | null
          rating: number | null
          region: string | null
          schedule: string | null
          status: Database["public"]["Enums"]["club_status"] | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          owner_id?: string | null
          rating?: number | null
          region?: string | null
          schedule?: string | null
          status?: Database["public"]["Enums"]["club_status"] | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          owner_id?: string | null
          rating?: number | null
          region?: string | null
          schedule?: string | null
          status?: Database["public"]["Enums"]["club_status"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dealer_latest_attendance: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          club_id: string | null
          created_at: string | null
          current_state: string | null
          dealer_id: string | null
          id: string | null
          overtime_minutes: number | null
          pre_assigned_at: string | null
          pre_assigned_table_id: string | null
          priority_break_flag: boolean | null
          shift_date: string | null
          shift_id: string | null
          status: string | null
          worked_minutes_since_last_break: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_attendance_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_pre_assigned_table_id_fkey"
            columns: ["pre_assigned_table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "dealer_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_my_rotation: {
        Row: {
          announce_at: string | null
          club_id: string | null
          i_am_incoming: boolean | null
          id: string | null
          is_emergency: boolean | null
          is_shortage: boolean | null
          planned_relief_at: string | null
          slot_index: number | null
          status: string | null
          table_id: string | null
          table_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_rotation_schedule_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_rotation_schedule_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_pool_summary: {
        Row: {
          assigned_count: number | null
          available_count: number | null
          club_id: string | null
          in_transition_count: number | null
          on_break_count: number | null
          ot_count: number | null
          pre_assigned_count: number | null
          total_checked_in: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_shift_metrics: {
        Row: {
          attendance_id: string | null
          club_id: string | null
          created_at: string | null
          current_state: string | null
          dealer_id: string | null
          dealer_status: string | null
          full_name: string | null
          last_break_end: string | null
          last_break_start: string | null
          last_table_id: string | null
          minutes_since_rest: number | null
          pre_assigned_at: string | null
          pre_assigned_table_id: string | null
          priority_break_flag: boolean | null
          shift_date: string | null
          skills: string[] | null
          status: string | null
          tier: string | null
          total_assignments: number | null
          total_break_minutes: number | null
          total_worked_minutes: number | null
          total_worked_minutes_today: number | null
          updated_at: string | null
          worked_minutes_since_last_break: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_attendance_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_attendance_pre_assigned_table_id_fkey"
            columns: ["pre_assigned_table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_state_health: {
        Row: {
          assigned_but_no_assignment: number | null
          available_but_assigned: number | null
          available_count: number | null
          on_break_count: number | null
          refreshed_at: string | null
          stuck_pre_assigned: number | null
          total_checked_in: number | null
        }
        Relationships: []
      }
      ghost_assignments_health: {
        Row: {
          ghost_count: number | null
          processed_not_released_total: number | null
          refreshed_at: string | null
          sample_ghosts: Json | null
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          region: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      tournament_leaderboard_view: {
        Row: {
          chip_count: number | null
          elimination_hand_id: string | null
          entry_number: number | null
          is_active: boolean | null
          is_itm: boolean | null
          player_id: string | null
          position: number | null
          prize: number | null
          seat_number: number | null
          table_id: string | null
          tournament_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_eliminations_hand_id_fkey"
            columns: ["elimination_hand_id"]
            isOneToOne: false
            referencedRelation: "tournament_hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tournament_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      v_club_swing_status: {
        Row: {
          active_tables: number | null
          auto_adjust_duration: boolean | null
          available_dealers: number | null
          base_duration_minutes: number | null
          club_id: string | null
          effective_duration_minutes: number | null
          fixed_duration: number | null
          max_duration_minutes: number | null
          min_duration_minutes: number | null
          pre_assigned_weighted: number | null
          table_type: string | null
          target_ratio: number | null
        }
        Relationships: [
          {
            foreignKeyName: "swing_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swing_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stuck_assignment_version_history: {
        Row: {
          attendance_id: string | null
          club_id: string | null
          club_name: string | null
          dealer_name: string | null
          id: string | null
          last_bump_at: string | null
          minutes_overdue: number | null
          pre_assigned_attendance_id: string | null
          release_reason: string | null
          released_at: string | null
          should_audit_version: boolean | null
          status: string | null
          swing_due_at: string | null
          table_id: string | null
          table_name: string | null
          total_bumps: number | null
          version: number | null
          version_progression: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_assignments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_latest_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_assignments_pre_assigned_attendance_id_fkey"
            columns: ["pre_assigned_attendance_id"]
            isOneToOne: false
            referencedRelation: "dealer_shift_metrics"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "dealer_assignments_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "game_tables"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_group_invite: { Args: { _token: string }; Returns: string }
      add_player_with_reentry:
        | {
            Args: {
              p_chip_count?: number
              p_player_id: string
              p_seat_number: number
              p_table_id: string
              p_tournament_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_chip_count?: number
              p_player_id: string
              p_player_name?: string
              p_seat_number: number
              p_table_id: string
              p_tournament_id: string
            }
            Returns: Json
          }
      approve_verification: {
        Args: {
          p_action: string
          p_rejection_reason?: string
          p_request_id: string
        }
        Returns: Json
      }
      assign_dealer_to_table: {
        Args: {
          p_assigned_at?: string
          p_attendance_id: string
          p_club_id?: string
          p_force_replace?: boolean
          p_idempotency_key?: string
          p_swing_due_at?: string
          p_table_id: string
        }
        Returns: Json
      }
      atomic_dealer_ready_check: {
        Args: { p_attendance_id: string; p_club_id: string }
        Returns: Json
      }
      auto_cancel_expired_commits: { Args: never; Returns: number }
      auto_cancel_expired_tournament_regs: { Args: never; Returns: number }
      auto_close_expired_deals: { Args: never; Returns: number }
      auto_close_low_priority_tables: {
        Args: { p_club_id: string }
        Returns: {
          table_id: string
          table_name: string
        }[]
      }
      auto_soft_delete_old_tournaments: { Args: never; Returns: number }
      bulk_update_stacks: {
        Args: { p_tournament_id: string; p_updates: Json }
        Returns: Json
      }
      calculate_club_payroll: {
        Args: { p_club_id: string; p_end_date: string; p_start_date: string }
        Returns: Json
      }
      calculate_dealer_payroll: {
        Args: {
          p_dealer_id: string
          p_dependents?: number
          p_end_date: string
          p_start_date: string
        }
        Returns: Json
      }
      calculate_dynamic_swing_duration: {
        Args: { p_club_id: string; p_table_type?: string }
        Returns: number
      }
      calculate_pit_vn: { Args: { p_taxable_income: number }; Returns: number }
      canary_health_check: { Args: { p_club_id: string }; Returns: Json }
      cancel_rotation_slot: {
        Args: { p_reason: string; p_schedule_id: string }
        Returns: Json
      }
      cashier_club_ids: { Args: { _user_id: string }; Returns: string[] }
      cleanup_expired_club_locks: { Args: never; Returns: undefined }
      cleanup_old_diagnostic_logs: { Args: never; Returns: undefined }
      cleanup_orphan_hands: { Args: { p_older_than?: string }; Returns: Json }
      cleanup_stale_attendance: {
        Args: { p_club_id?: string; p_stale_threshold_hours?: number }
        Returns: Json
      }
      club_local_date: { Args: { p_club_id: string }; Returns: string }
      complete_dealer_break: {
        Args: { p_attendance_id: string }
        Returns: Json
      }
      complete_rotation_slot: {
        Args: { p_new_assignment_id: string; p_schedule_id: string }
        Returns: Json
      }
      compute_compensated_swing_due_at: {
        Args: { p_base_duration: number; p_now: string; p_ot_minutes: number }
        Returns: string
      }
      compute_short_notice_bonus_min: {
        Args: {
          p_pre_announce_min: number
          p_pre_assigned_at: string
          p_swing_due_at: string
        }
        Returns: number
      }
      confirm_registration_and_assign_seat: {
        Args: {
          p_actor_user_id: string
          p_draw_mode?: string
          p_registration_id: string
        }
        Returns: Json
      }
      count_available_dealers: { Args: { p_club_id: string }; Returns: number }
      create_offline_buyin_and_seat: {
        Args: {
          p_buy_in: number
          p_draw_mode?: string
          p_fee: number
          p_player_name: string
          p_tournament_id: string
        }
        Returns: Json
      }
      reenter_tournament_player: {
        Args: {
          p_buy_in: number
          p_draw_mode?: string
          p_entry_id: string
          p_fee: number
        }
        Returns: Json
      }
      void_registration: {
        Args: { p_reason?: string; p_registration_id: string }
        Returns: Json
      }
      dealer_control_club_ids: { Args: { _user_id: string }; Returns: string[] }
      delete_last_action: {
        Args: { p_hand_id: string; p_user_id?: string }
        Returns: Json
      }
      detect_stuck_breaks: {
        Args: { p_club_id: string }
        Returns: {
          attendance_id: string
          break_id: string
          dealer_id: string
          dealer_name: string
          expected_min: number
          overdue_min: number
        }[]
      }
      disable_stale_audit_flags: {
        Args: { p_stale_after_hours?: number }
        Returns: number
      }
      enable_audit_for_stuck_rows: {
        Args: { p_club_id: string; p_min_overdue_min?: number }
        Returns: number
      }
      end_dealer_break: {
        Args: { p_attendance_id: string; p_break_id: string }
        Returns: Json
      }
      end_expired_breaks: {
        Args: { p_club_id?: string }
        Returns: {
          attendance_id: string
          break_start: string
          dealer_name: string
          expected_duration_minutes: number
        }[]
      }
      execute_pre_assigned_swing: {
        Args: {
          p_break_duration_minutes: number
          p_duration_minutes: number
          p_next_attendance_id: string
          p_old_assignment_id: string
          p_send_to_break: boolean
          p_swing_due_at: string
        }
        Returns: Json
      }
      execute_pre_assigned_swing_rpc: {
        Args: {
          p_break_duration_minutes?: number
          p_duration_minutes: number
          p_next_attendance_id: string
          p_old_assignment_id: string
          p_send_to_break?: boolean
          p_swing_due_at: string
        }
        Returns: Json
      }
      fill_dealer_id: {
        Args: {
          p_assignment_id: string
          p_expected_version: number
          p_new_attendance_id?: string
        }
        Returns: Json
      }
      fn_compute_staking_payouts: {
        Args: { _markup: number; _percentage: number; _prize_vnd: number }
        Returns: Json
      }
      force_release_stuck_assignment: {
        Args: { p_assignment_id: string; p_club_id: string; p_reason?: string }
        Returns: Json
      }
      gen_escrow_reference: { Args: never; Returns: string }
      get_audit_log_count: { Args: { p_club_id: string }; Returns: number }
      get_available_attendance: {
        Args: { p_club_id: string }
        Returns: {
          id: string
        }[]
      }
      get_deal_purchase_breakdown: {
        Args: { _deal_ids: string[] }
        Returns: {
          deal_id: string
          funded_count: number
          funded_pct: number
          pending_count: number
          pending_pct: number
        }[]
      }
      get_dealer_last_tables: {
        Args: { p_dealer_ids: string[] }
        Returns: {
          dealer_id: string
          table_id: string
        }[]
      }
      get_dealer_payroll: {
        Args: { p_club_id: string; p_from_date: string; p_to_date: string }
        Returns: {
          base_pay: number
          base_rate_vnd: number
          days_worked: number
          dealer_id: string
          employment_type: string
          full_name: string
          hourly_rate_vnd: number
          ot_hours: number
          overtime_minutes: number
          overtime_pay: number
          regular_hours: number
          tier: string
          total_hours: number
          total_pay: number
          total_swings: number
        }[]
      }
      get_dealer_pool_snapshot: {
        Args: { p_club_id: string; p_table_type?: string }
        Returns: Json
      }
      get_dealer_worked_times: {
        Args: { p_shift_date: string }
        Returns: {
          dealer_id: string
          total_minutes: number
        }[]
      }
      get_effective_swing_config: {
        Args: { p_table_id: string }
        Returns: {
          crit_at_minutes: number
          source: string
          swing_duration_minutes: number
          warn_at_minutes: number
        }[]
      }
      get_escalation_config: {
        Args: { p_club_id: string }
        Returns: {
          audit_enabled_min_overdue_min: number
          force_release_at_overdue_min: number
          tier_1_min_overdue_min: number
          tier_1_min_rest_min: number
          tier_2_min_overdue_min: number
          tier_2_min_rest_min: number
          tier_2_skip_priority_break: boolean
          tier_3_min_overdue_min: number
          tier_3_min_rest_min: number
          tier_3_skip_fatigue_cap: boolean
        }[]
      }
      get_invite_preview: {
        Args: { _token: string }
        Returns: {
          avatar_url: string
          group_id: string
          group_name: string
          is_public: boolean
          member_count: number
          reason: string
          valid: boolean
        }[]
      }
      get_next_hand_number: {
        Args: { p_table_id: string; p_tournament_id: string }
        Returns: number
      }
      get_rotation_board: { Args: { p_club_id: string }; Returns: Json }
      get_seats_for_draw: { Args: { p_tournament_id: string }; Returns: Json }
      get_shift_payroll_summary: {
        Args: { p_club_id: string; p_shift_date: string }
        Returns: {
          base_pay: number
          dealer_name: string
          overtime_minutes: number
          overtime_pay: number
          swings_done: number
          tables_served: number
          tier: string
          total_minutes: number
        }[]
      }
      get_swing_metrics: { Args: never; Returns: Json }
      get_table_assignments_with_next: {
        Args: { p_club_id: string }
        Returns: {
          current_dealer: string
          minutes_until_swing: number
          next_dealer: string
          next_dealer_tier: string
          overtime_started_at: string
          table_id: string
          table_name: string
        }[]
      }
      get_table_swing_duration: {
        Args: { p_table_id: string }
        Returns: number
      }
      get_tournament_blinds: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      get_tournament_clock: { Args: { p_tournament_id: string }; Returns: Json }
      get_tournament_leaderboard: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      get_tournament_prizes: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      get_tournament_state: { Args: { p_tournament_id: string }; Returns: Json }
      get_tournament_tables: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      get_tv_display_state: { Args: { p_display_token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat_lock: {
        Args: { p_hand_id: string; p_user_id?: string }
        Returns: Json
      }
      import_blind_structure: {
        Args: { p_csv_data: string; p_tournament_id: string }
        Returns: Json
      }
      is_club_admin: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_cashier: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_dealer_control: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_owner: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_tracker: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_deal_club_owner: {
        Args: { _deal_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_creator: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_media_or_admin: { Args: { _user_id: string }; Returns: boolean }
      lock_rotation_slot: {
        Args: { p_schedule_id: string; p_schedule_version: number }
        Returns: Json
      }
      mark_payroll_paid: {
        Args: {
          p_note?: string
          p_paid_at?: string
          p_payment_ref: string
          p_period_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      move_player_seat: {
        Args: {
          p_actor_user_id: string
          p_entry_id: string
          p_reason?: string
          p_to_seat_number: number
          p_to_tournament_table_id: string
        }
        Returns: Json
      }
      notify_expiring_commits: { Args: never; Returns: number }
      op_claim_daily_chips: { Args: never; Returns: Json }
      op_get_my_hole_cards: { Args: { p_hand_id: string }; Returns: Json }
      op_is_enabled: { Args: never; Returns: boolean }
      op_load_action_context: { Args: { p_hand_id: string }; Returns: Json }
      op_sit_down: {
        Args: {
          p_buyin: number
          p_idempotency_key: string
          p_seat_no: number
          p_table_id: string
        }
        Returns: Json
      }
      op_stand_up: {
        Args: { p_idempotency_key: string; p_table_id: string }
        Returns: Json
      }
      op_start_hand: {
        Args: {
          p_act_deadline: string
          p_actor_user_id: string
          p_board_future: Json
          p_deck: Json
          p_engine_version: string
          p_events: Json
          p_holes: Json
          p_state: Json
        }
        Returns: Json
      }
      op_submit_action: {
        Args: {
          p_act_deadline: string
          p_action: Json
          p_actor_user_id: string
          p_board_future: Json
          p_events: Json
          p_expected_state_version: number
          p_hand_id: string
          p_idempotency_key: string
          p_new_state: Json
        }
        Returns: Json
      }
      op_timeout_sweep: { Args: never; Returns: Json }
      perform_swing:
        | {
            Args: {
              p_assignment_id: string
              p_break_duration_minutes?: number
              p_duration_minutes?: number
              p_expected_version?: number
              p_max_break_minutes?: number
              p_next_attendance_id?: string
              p_rest_deficit_minutes?: number
              p_send_to_break?: boolean
            }
            Returns: Json
          }
        | {
            Args: {
              p_assignment_id: string
              p_break_duration_minutes?: number
              p_next_attendance_id: string
              p_reason?: string
              p_send_to_break?: boolean
            }
            Returns: Json
          }
        | {
            Args: {
              p_assignment_id: string
              p_break_duration_minutes?: number
              p_next_attendance_id: string
              p_rest_deficit_minutes?: number
              p_send_to_break?: boolean
              p_swing_due_at?: string
              p_swing_duration_minutes?: number
              p_version: number
            }
            Returns: Json
          }
      pre_assign_next_dealer_for_table: {
        Args: {
          p_assignment_id: string
          p_club_id: string
          p_next_attendance_id: string
          p_version: number
        }
        Returns: Json
      }
      predict_dealer_demand: {
        Args: { p_club_id: string; p_date: string }
        Returns: {
          multiplier: number
          reasoning: string
          suggested_dealers: number
        }[]
      }
      predict_next_dealers: {
        Args: { p_club_id: string }
        Returns: {
          current_dealer: string
          minutes_until_swing: number
          next_dealer: string
          next_dealer_tier: string
          overtime_started_at: string
          table_id: string
          table_name: string
        }[]
      }
      prepare_payroll_payment: {
        Args: {
          p_note?: string
          p_payment_method: string
          p_period_id: string
          p_user_id: string
        }
        Returns: string
      }
      re_enter_tournament: {
        Args: {
          p_new_chip_count?: number
          p_player_id: string
          p_tournament_id: string
        }
        Returns: Json
      }
      recalc_active_swing_due_at: {
        Args: { p_club_id: string }
        Returns: undefined
      }
      recompute_player_stats: {
        Args: { _player_id: string }
        Returns: undefined
      }
      reconcile_dealer_room_state: {
        Args: {
          p_admin_override?: boolean
          p_club_id: string
          p_corrections: Json
          p_displaced?: Json
          p_dry_run?: boolean
          p_effective_at: string
          p_reason: string
        }
        Returns: Json
      }
      reconcile_dealer_states: { Args: { p_club_id: string }; Returns: Json }
      reconcile_ghost_assignments: {
        Args: { p_club_id?: string }
        Returns: Json
      }
      reconcile_payroll_payment: {
        Args: {
          p_note?: string
          p_period_id: string
          p_reconciliation_ref?: string
          p_user_id: string
        }
        Returns: boolean
      }
      record_action: {
        Args: {
          p_action_amount: number
          p_action_order: number
          p_action_type: string
          p_entry_number: number
          p_hand_id: string
          p_player_id: string
          p_street: string
        }
        Returns: Json
      }
      record_hand:
        | {
            Args: {
              p_actions: Json
              p_hand_number: number
              p_hand_time: string
              p_players: Json
              p_side_pots?: Json
              p_table_id: string
              p_tournament_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_actions: Json
              p_community_cards?: Json
              p_created_by?: string
              p_hand_number: number
              p_hand_time: string
              p_players: Json
              p_pot_size?: number
              p_side_pots?: Json
              p_table_id: string
              p_tournament_id: string
            }
            Returns: Json
          }
      refresh_dealer_pool_summary: { Args: never; Returns: undefined }
      release_club_lock: { Args: { p_club_id: string }; Returns: undefined }
      release_cron_lock: { Args: { p_lock_name: string }; Returns: undefined }
      release_dealer_from_table: {
        Args: { p_released_by?: string; p_table_id: string }
        Returns: Json
      }
      save_payroll_period: {
        Args: {
          p_club_id: string
          p_end_date: string
          p_month: number
          p_payroll_rows: Json
          p_start_date: string
          p_user_id: string
          p_year: number
        }
        Returns: string
      }
      seed_swing_test_data: { Args: never; Returns: Json }
      select_dealer_for_update: {
        Args: { p_attendance_id: string }
        Returns: boolean
      }
      set_rotation_slot_dealer: {
        Args: {
          p_new_attendance_id: string
          p_reason?: string
          p_schedule_id: string
          p_schedule_version: number
        }
        Returns: Json
      }
      show_hole_cards: {
        Args: {
          p_hand_id: string
          p_player_hole_cards: Json
          p_user_id?: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_hand: {
        Args: {
          p_button_seat?: number
          p_created_by?: string
          p_hand_number: number
          p_hand_time?: string
          p_table_id: string
          p_tournament_id: string
        }
        Returns: Json
      }
      suggest_swing_config: { Args: { p_club_id: string }; Returns: Json }
      swing_operations_summary: {
        Args: { p_club_id: string; p_hours_back?: number }
        Returns: Json
      }
      tournament_break_all_tables: {
        Args: {
          p_club_id: string
          p_duration_minutes?: number
          p_reason?: string
        }
        Returns: Json
      }
      tracker_club_ids: { Args: { _user_id: string }; Returns: string[] }
      transition_dealer_state: {
        Args: {
          p_attendance_id: string
          p_new_state: string
          p_reason?: string
        }
        Returns: Json
      }
      transition_payroll_status: {
        Args: {
          p_expected_status: string
          p_new_status: string
          p_period_id: string
          p_rejection_reason?: string
          p_user_id: string
        }
        Returns: boolean
      }
      try_acquire_club_lock:
        | { Args: { p_club_id: string }; Returns: boolean }
        | {
            Args: { p_club_id: string; p_timeout_seconds?: number }
            Returns: Json
          }
      try_acquire_cron_lock: { Args: { p_lock_name: string }; Returns: boolean }
      tv_claim_display: {
        Args: {
          p_club_id: string
          p_name: string
          p_pair_code: string
          p_zone?: string
        }
        Returns: Json
      }
      tv_pair_begin: { Args: never; Returns: Json }
      tv_revoke_display: { Args: { p_display_id: string }; Returns: Json }
      undo_last_action: { Args: { p_hand_id: string }; Returns: Json }
      update_community_cards: {
        Args: { p_community_cards: Json; p_hand_id: string; p_user_id?: string }
        Returns: Json
      }
      update_stack: {
        Args: {
          p_chip_count: number
          p_entry_number: number
          p_player_id: string
          p_tournament_id: string
        }
        Returns: Json
      }
      update_tournament_blinds: {
        Args: { p_blinds: Json; p_tournament_id: string }
        Returns: Json
      }
      update_tournament_prizes: {
        Args: { p_prizes: Json; p_tournament_id: string }
        Returns: Json
      }
      update_tournament_state: {
        Args: { p_reason?: string; p_status: string; p_tournament_id: string }
        Returns: Json
      }
      upsert_rotation_plan: {
        Args: {
          p_club_id: string
          p_plan_run_id: string
          p_rows: Json
          p_table_ids?: string[]
        }
        Returns: Json
      }
      validate_cards: { Args: { p_cards: Json }; Returns: string }
      verify_swing_queries: { Args: { p_club_id?: string }; Returns: Json }
      void_last_hand: { Args: { p_hand_id: string }; Returns: Json }
    }
    Enums: {
      app_role:
        | "player"
        | "club_admin"
        | "super_admin"
        | "cashier"
        | "media"
        | "club_cashier"
        | "dealer_control"
        | "tracker"
      backing_interest_status: "pending" | "contacted" | "declined"
      backing_review_status: "off" | "pending" | "approved" | "rejected"
      club_status: "pending" | "approved" | "rejected"
      escrow_tx_type:
        | "fund_lock"
        | "payout_player"
        | "payout_backer"
        | "platform_fee"
        | "refund"
      escrow_type: "manual_bank_vnd" | "smart_contract_usdt"
      notification_type:
        | "deal_committed"
        | "deal_funded"
        | "deal_auto_cancelled"
        | "result_entered"
        | "result_verified"
        | "result_disputed"
        | "release_requested"
        | "payout_executed"
        | "system_announcement"
        | "deal_expiring_soon"
        | "deal_auto_closed"
        | "schedule_updated"
        | "registration_confirmed"
        | "chat_message"
        | "verification_approved"
        | "verification_rejected"
        | "purchase_funded"
        | "player_checked_in"
        | "club_schedule_updated"
        | "tournament_created"
        | "stream_live"
      registration_status: "pending" | "confirmed" | "rejected" | "cancelled"
      release_condition_type: "both_confirm" | "admin_override"
      release_request_status:
        | "pending_cosign"
        | "approved"
        | "executed"
        | "cancelled"
      staking_admin_review_status: "pending" | "approved" | "rejected"
      staking_audit_action:
        | "created"
        | "reviewed"
        | "committed"
        | "funded"
        | "result_entered"
        | "release_requested"
        | "release_cosigned"
        | "released"
        | "disputed"
        | "admin_override"
        | "cancelled"
        | "updated"
        | "auto_cancelled_timeout"
        | "admin_confirmed_funded"
        | "admin_cancelled_deal"
        | "result_verified"
        | "result_disputed"
        | "admin_override_applied"
        | "payout_executed"
        | "auto_closed_deadline"
      staking_deal_status:
        | "listing"
        | "committed"
        | "funded"
        | "locked"
        | "released"
        | "disputed"
        | "cancelled"
        | "result_entered"
        | "result_verified"
        | "result_disputed"
        | "release_requested"
        | "cosigned"
        | "completed"
        | "committing"
      tournament_status: "scheduled" | "live" | "finished" | "cancelled"
      upcoming_event_status: "open" | "closed" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "player",
        "club_admin",
        "super_admin",
        "cashier",
        "media",
        "club_cashier",
        "dealer_control",
        "tracker",
      ],
      backing_interest_status: ["pending", "contacted", "declined"],
      backing_review_status: ["off", "pending", "approved", "rejected"],
      club_status: ["pending", "approved", "rejected"],
      escrow_tx_type: [
        "fund_lock",
        "payout_player",
        "payout_backer",
        "platform_fee",
        "refund",
      ],
      escrow_type: ["manual_bank_vnd", "smart_contract_usdt"],
      notification_type: [
        "deal_committed",
        "deal_funded",
        "deal_auto_cancelled",
        "result_entered",
        "result_verified",
        "result_disputed",
        "release_requested",
        "payout_executed",
        "system_announcement",
        "deal_expiring_soon",
        "deal_auto_closed",
        "schedule_updated",
        "registration_confirmed",
        "chat_message",
        "verification_approved",
        "verification_rejected",
        "purchase_funded",
        "player_checked_in",
        "club_schedule_updated",
        "tournament_created",
        "stream_live",
      ],
      registration_status: ["pending", "confirmed", "rejected", "cancelled"],
      release_condition_type: ["both_confirm", "admin_override"],
      release_request_status: [
        "pending_cosign",
        "approved",
        "executed",
        "cancelled",
      ],
      staking_admin_review_status: ["pending", "approved", "rejected"],
      staking_audit_action: [
        "created",
        "reviewed",
        "committed",
        "funded",
        "result_entered",
        "release_requested",
        "release_cosigned",
        "released",
        "disputed",
        "admin_override",
        "cancelled",
        "updated",
        "auto_cancelled_timeout",
        "admin_confirmed_funded",
        "admin_cancelled_deal",
        "result_verified",
        "result_disputed",
        "admin_override_applied",
        "payout_executed",
        "auto_closed_deadline",
      ],
      staking_deal_status: [
        "listing",
        "committed",
        "funded",
        "locked",
        "released",
        "disputed",
        "cancelled",
        "result_entered",
        "result_verified",
        "result_disputed",
        "release_requested",
        "cosigned",
        "completed",
        "committing",
      ],
      tournament_status: ["scheduled", "live", "finished", "cancelled"],
      upcoming_event_status: ["open", "closed", "completed"],
    },
  },
} as const
