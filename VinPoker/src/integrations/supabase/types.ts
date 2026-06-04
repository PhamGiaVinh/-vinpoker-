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
          {
            foreignKeyName: "booking_chats_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
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
        Relationships: [
          {
            foreignKeyName: "stack_registrations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "staking_deals_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
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
        Relationships: [
          {
            foreignKeyName: "stream_comments_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "tournament_streams_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          buy_in: number
          club_id: string
          created_at: string
          current_blinds: string | null
          current_level: number | null
          current_players: number
          deleted_at: string | null
          description: string | null
          game_type: string
          id: string
          late_reg_close_level: number
          live_status: string
          location: string | null
          minutes_per_level: number
          name: string
          schedule_upload_id: string | null
          start_time: string
          starting_stack: number
          status: Database["public"]["Enums"]["tournament_status"]
          updated_at: string
        }
        Insert: {
          buy_in: number
          club_id: string
          created_at?: string
          current_blinds?: string | null
          current_level?: number | null
          current_players?: number
          deleted_at?: string | null
          description?: string | null
          game_type?: string
          id?: string
          late_reg_close_level?: number
          live_status?: string
          location?: string | null
          minutes_per_level?: number
          name: string
          schedule_upload_id?: string | null
          start_time: string
          starting_stack: number
          status?: Database["public"]["Enums"]["tournament_status"]
          updated_at?: string
        }
        Update: {
          buy_in?: number
          club_id?: string
          created_at?: string
          current_blinds?: string | null
          current_level?: number | null
          current_players?: number
          deleted_at?: string | null
          description?: string | null
          game_type?: string
          id?: string
          late_reg_close_level?: number
          live_status?: string
          location?: string | null
          minutes_per_level?: number
          name?: string
          start_time?: string
          starting_stack?: number
          status?: Database["public"]["Enums"]["tournament_status"]
          updated_at?: string
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
    }
    Functions: {
      accept_group_invite: { Args: { _token: string }; Returns: string }
      auto_cancel_expired_commits: { Args: never; Returns: number }
      auto_cancel_expired_tournament_regs: { Args: never; Returns: number }
      auto_close_expired_deals: { Args: never; Returns: number }
      auto_soft_delete_old_tournaments: { Args: never; Returns: number }
      cashier_club_ids: { Args: { _user_id: string }; Returns: string[] }
      fn_compute_staking_payouts: {
        Args: { _markup: number; _percentage: number; _prize_vnd: number }
        Returns: Json
      }
      gen_escrow_reference: { Args: never; Returns: string }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_club_cashier: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_owner: {
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
      notify_expiring_commits: { Args: never; Returns: number }
      recompute_player_stats: {
        Args: { _player_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role:
        | "player"
        | "club_admin"
        | "super_admin"
        | "cashier"
        | "media"
        | "club_cashier"
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

const Constants = {
  public: {
    Enums: {
      app_role: [
        "player",
        "club_admin",
        "super_admin",
        "cashier",
        "media",
        "club_cashier",
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
