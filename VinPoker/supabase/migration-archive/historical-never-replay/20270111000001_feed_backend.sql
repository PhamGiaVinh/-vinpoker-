-- Feed backend recovery (source-only until the owner applies this exact SHA through the runbook).
--
-- Data contract:
--   * authenticated users may read active posts/stories and create only records attributed to auth.uid();
--   * like and story-view pairs are unique, so retries or double-clicks cannot create duplicates;
--   * post counters are maintained by a non-invokable trigger function, never by the client;
--   * feed media is publicly readable by product decision, while writes remain restricted by Storage RLS.
--
-- Rollback: do not drop user content. Ship a follow-up PR to hide /feed interactions and revoke the
-- authenticated grants and policies below; retain these tables and storage objects for preservation.

CREATE TABLE IF NOT EXISTS public.feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  post_type text NOT NULL DEFAULT 'general'
    CHECK (post_type IN ('general', 'hand_review', 'achievement')),
  poker_hand jsonb,
  media_urls text[] NOT NULL DEFAULT '{}',
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_posts_content_or_media_check
    CHECK (char_length(btrim(content)) > 0 OR cardinality(media_urls) > 0)
);

CREATE TABLE IF NOT EXISTS public.feed_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_post_likes (
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.feed_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_story_views (
  story_id uuid NOT NULL REFERENCES public.feed_stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS feed_posts_active_created_at_idx
  ON public.feed_posts (created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS feed_stories_created_at_idx
  ON public.feed_stories (created_at DESC);
CREATE INDEX IF NOT EXISTS feed_post_likes_user_post_idx
  ON public.feed_post_likes (user_id, post_id);
CREATE INDEX IF NOT EXISTS feed_post_comments_active_post_created_at_idx
  ON public.feed_post_comments (post_id, created_at ASC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS feed_story_views_story_viewed_at_idx
  ON public.feed_story_views (story_id, viewed_at DESC);

ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_story_views ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.feed_posts FROM anon, authenticated;
REVOKE ALL ON TABLE public.feed_stories FROM anon, authenticated;
REVOKE ALL ON TABLE public.feed_post_likes FROM anon, authenticated;
REVOKE ALL ON TABLE public.feed_post_comments FROM anon, authenticated;
REVOKE ALL ON TABLE public.feed_story_views FROM anon, authenticated;

GRANT SELECT ON TABLE public.feed_posts TO authenticated;
GRANT INSERT (author_id, content, post_type, poker_hand, media_urls)
  ON TABLE public.feed_posts TO authenticated;
GRANT SELECT ON TABLE public.feed_stories TO authenticated;
GRANT INSERT (author_id, media_url, media_type, caption)
  ON TABLE public.feed_stories TO authenticated;
GRANT SELECT, DELETE ON TABLE public.feed_post_likes TO authenticated;
GRANT INSERT (post_id, user_id) ON TABLE public.feed_post_likes TO authenticated;
GRANT SELECT ON TABLE public.feed_post_comments TO authenticated;
GRANT INSERT (post_id, user_id, content) ON TABLE public.feed_post_comments TO authenticated;
GRANT SELECT ON TABLE public.feed_story_views TO authenticated;
GRANT INSERT (story_id, viewer_id) ON TABLE public.feed_story_views TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_posts'
      AND policyname = 'Authenticated users read active feed posts'
  ) THEN
    CREATE POLICY "Authenticated users read active feed posts"
      ON public.feed_posts FOR SELECT TO authenticated
      USING (is_deleted = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_posts'
      AND policyname = 'Authors create their own feed posts'
  ) THEN
    CREATE POLICY "Authors create their own feed posts"
      ON public.feed_posts FOR INSERT TO authenticated
      WITH CHECK (
        author_id = (SELECT auth.uid())
        AND is_deleted = false
        AND like_count = 0
        AND comment_count = 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_stories'
      AND policyname = 'Authenticated users read feed stories'
  ) THEN
    CREATE POLICY "Authenticated users read feed stories"
      ON public.feed_stories FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_stories'
      AND policyname = 'Authors create their own feed stories'
  ) THEN
    CREATE POLICY "Authors create their own feed stories"
      ON public.feed_stories FOR INSERT TO authenticated
      WITH CHECK (author_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_post_likes'
      AND policyname = 'Users read their own feed likes'
  ) THEN
    CREATE POLICY "Users read their own feed likes"
      ON public.feed_post_likes FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_post_likes'
      AND policyname = 'Users create their own feed likes'
  ) THEN
    CREATE POLICY "Users create their own feed likes"
      ON public.feed_post_likes FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.feed_posts AS post
          WHERE post.id = feed_post_likes.post_id
            AND post.is_deleted = false
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_post_likes'
      AND policyname = 'Users delete their own feed likes'
  ) THEN
    CREATE POLICY "Users delete their own feed likes"
      ON public.feed_post_likes FOR DELETE TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_post_comments'
      AND policyname = 'Authenticated users read active feed comments'
  ) THEN
    CREATE POLICY "Authenticated users read active feed comments"
      ON public.feed_post_comments FOR SELECT TO authenticated
      USING (is_deleted = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_post_comments'
      AND policyname = 'Users create their own feed comments'
  ) THEN
    CREATE POLICY "Users create their own feed comments"
      ON public.feed_post_comments FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND is_deleted = false
        AND EXISTS (
          SELECT 1
          FROM public.feed_posts AS post
          WHERE post.id = feed_post_comments.post_id
            AND post.is_deleted = false
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_story_views'
      AND policyname = 'Story owners or viewers read feed story views'
  ) THEN
    CREATE POLICY "Story owners or viewers read feed story views"
      ON public.feed_story_views FOR SELECT TO authenticated
      USING (
        viewer_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.feed_stories AS story
          WHERE story.id = feed_story_views.story_id
            AND story.author_id = (SELECT auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feed_story_views'
      AND policyname = 'Users create their own feed story views'
  ) THEN
    CREATE POLICY "Users create their own feed story views"
      ON public.feed_story_views FOR INSERT TO authenticated
      WITH CHECK (viewer_id = (SELECT auth.uid()));
  END IF;
END
$$;

-- The function has no client grant. It can only run from the two triggers below,
-- which prevents a client from choosing arbitrary counter values.
CREATE OR REPLACE FUNCTION public.refresh_feed_post_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_post_id uuid := COALESCE(NEW.post_id, OLD.post_id);
BEGIN
  UPDATE public.feed_posts AS post
  SET
    like_count = (
      SELECT count(*)::integer
      FROM public.feed_post_likes AS likes
      WHERE likes.post_id = target_post_id
    ),
    comment_count = (
      SELECT count(*)::integer
      FROM public.feed_post_comments AS comments
      WHERE comments.post_id = target_post_id
        AND comments.is_deleted = false
    )
  WHERE post.id = target_post_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_feed_post_counts() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'feed_post_likes_refresh_counts'
      AND tgrelid = 'public.feed_post_likes'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER feed_post_likes_refresh_counts
      AFTER INSERT OR DELETE ON public.feed_post_likes
      FOR EACH ROW EXECUTE FUNCTION public.refresh_feed_post_counts();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'feed_post_comments_refresh_counts'
      AND tgrelid = 'public.feed_post_comments'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER feed_post_comments_refresh_counts
      AFTER INSERT OR DELETE ON public.feed_post_comments
      FOR EACH ROW EXECUTE FUNCTION public.refresh_feed_post_counts();
  END IF;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feed-media',
  'feed-media',
  true,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users upload feed media to own folder'
  ) THEN
    CREATE POLICY "Authenticated users upload feed media to own folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'feed-media'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
        AND (
          (
            lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
            AND COALESCE((metadata ->> 'size')::bigint, 0) <= 10485760
          )
          OR (
            lower(storage.extension(name)) = ANY (ARRAY['mp4', 'webm', 'mov'])
            AND COALESCE((metadata ->> 'size')::bigint, 0) <= 52428800
          )
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publication is required for feed realtime updates';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'feed_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_posts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'feed_stories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_stories;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'feed_post_likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_post_likes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'feed_post_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_post_comments;
  END IF;
END
$$;
