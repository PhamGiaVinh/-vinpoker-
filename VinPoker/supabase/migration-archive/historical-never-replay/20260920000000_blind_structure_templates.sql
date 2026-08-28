-- ============================================================================
-- blind_structure_templates — reusable named blind structures per club
-- ============================================================================
-- SOURCE-ONLY. NOT applied to production here. Requires a controlled DB apply
-- before the `blindTemplates` UI is enabled (until then the UI is gated OFF and
-- never queries this table).
--
-- Lets the floor save a blind structure under a name ("Tour A", "Turbo 15'", …)
-- once per club and reuse it: at tournament creation the floor picks a saved
-- structure, which seeds the new tournament's tournament_levels so the clock /
-- tracker / cashier / registration all run off it.
--
-- `levels` is the same JSONB shape the editor + update_blind_structure use:
--   [{ level_number, small_blind, big_blind, ante, duration_minutes, is_break }]
--
-- RLS mirrors the live "tournament_levels manageable by admins" policy:
-- club owner (clubs.owner_id) or a club_cashiers row for the caller.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.blind_structure_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    levels      JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by  UUID DEFAULT auth.uid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blind_structure_templates_club
    ON public.blind_structure_templates (club_id);

ALTER TABLE public.blind_structure_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Manage (select/insert/update/delete) only for the club's owner or cashiers.
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'blind_structure_templates'
          AND policyname = 'Blind templates manageable by club staff'
    ) THEN
        CREATE POLICY "Blind templates manageable by club staff"
            ON public.blind_structure_templates
            FOR ALL TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.clubs c
                    LEFT JOIN public.club_cashiers cc
                      ON cc.club_id = blind_structure_templates.club_id
                     AND cc.user_id = auth.uid()
                    WHERE c.id = blind_structure_templates.club_id
                      AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.clubs c
                    LEFT JOIN public.club_cashiers cc
                      ON cc.club_id = blind_structure_templates.club_id
                     AND cc.user_id = auth.uid()
                    WHERE c.id = blind_structure_templates.club_id
                      AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
                )
            );
    END IF;
END $$;
