import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";

export interface SentMarketingPost {
  id: string;
  title: string | null;
  body: string;
  channels: string[];
  sentAt: string | null;
}

export interface MarketingPostsResult {
  posts: SentMarketingPost[];
  loading: boolean;
  /** false when the read failed (no marketing access / RLS) — the UI degrades to a manual entry, never guesses. */
  available: boolean;
}

/**
 * W7 — read the club's already-SENT marketing posts so the owner can attach one to a series event as a
 * campaign log (spend + effect), instead of typing it by hand. READ-ONLY; defensive: any error (the
 * owner may not hold the marketing role, RLS may block) resolves to `available:false` so the panel falls
 * back to manual entry rather than showing a broken state. Gated by FEATURES.marketingModule.
 */
export function useMarketingPosts(clubId: string | undefined): MarketingPostsResult {
  const q = useQuery({
    queryKey: ["seriesMkt", "sentPosts", clubId],
    enabled: !!clubId && FEATURES.marketingModule,
    queryFn: async (): Promise<{ ok: boolean; posts: SentMarketingPost[] }> => {
      const { data, error } = await supabase
        .from("marketing_posts")
        .select("id,title,body,channels,sent_at,status")
        .eq("club_id", clubId as string)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(30);
      if (error) return { ok: false, posts: [] };
      const posts: SentMarketingPost[] = (data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title ?? null,
        body: typeof r.body === "string" ? r.body : "",
        channels: Array.isArray(r.channels) ? r.channels.map(String) : [],
        sentAt: r.sent_at ?? null,
      }));
      return { ok: true, posts };
    },
    retry: false,
    staleTime: 60_000,
  });

  return {
    posts: q.data?.posts ?? [],
    loading: q.isLoading,
    available: !!FEATURES.marketingModule && !!clubId && (q.data?.ok ?? false),
  };
}
