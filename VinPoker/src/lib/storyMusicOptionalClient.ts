import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Source-only optional feature contract, NOT a declaration that this table is live.
// Callers must surface missing-table/read errors and must not upload before a successful read.
type StoryMusicRow = {
  id: string; name: string; artist: string | null; file_url: string; duration: number | null;
  genre: string | null; source: string; created_at: string; created_by: string | null; thumbnail_url: string | null;
};
type StoryMusicContract = { public: {
  Tables: { feed_story_music: { Row: StoryMusicRow; Insert: Partial<StoryMusicRow> & { name: string; file_url: string };
    Update: Partial<StoryMusicRow>; Relationships: [] } };
  Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
export const storyMusicOptionalClient = supabase as unknown as SupabaseClient<StoryMusicContract>;
