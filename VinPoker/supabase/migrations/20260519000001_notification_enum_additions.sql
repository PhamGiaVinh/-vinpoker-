-- Add missing notification_type enum values
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'verification_approved';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'verification_rejected';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'purchase_funded';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'player_checked_in';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'club_schedule_updated';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'tournament_created';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'stream_live';
