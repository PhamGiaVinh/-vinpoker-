-- Restore column-level security on public.profiles to hide PII (phone, bank_*) from anon
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (id, user_id, display_name, region, avatar_url, bio,
              is_verified, rating_avg, total_deals, display_name_lower,
              created_at, updated_at)
  ON public.profiles TO anon;

GRANT SELECT (id, user_id, display_name, region, avatar_url, bio,
              is_verified, rating_avg, total_deals, display_name_lower,
              created_at, updated_at,
              phone, bank_name, bank_account_number, bank_account_holder,
              welcome_email_sent_at)
  ON public.profiles TO authenticated;
