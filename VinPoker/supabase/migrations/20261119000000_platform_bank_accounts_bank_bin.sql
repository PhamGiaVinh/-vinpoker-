-- VietQR Stage 2: explicit NAPAS acquirer BIN on platform_bank_accounts (for dynamic VietQR).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: the dynamic VietQR builder needs the 6-digit NAPAS acquirer BIN, but platform_bank_accounts
-- only stored a free-text bank_name. This adds an explicit, validated bank_bin so production resolves
-- the BIN deterministically instead of guessing from the name. Legacy rows stay NULL → the app falls
-- back to the free-text bank-name map (src/lib/vietnamBanks.ts). No backfill, no behavior change until
-- an admin sets a BIN via the bank-config picker.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS; the format CHECK is added via a DO guard
-- (ADD CONSTRAINT has no IF NOT EXISTS). Rollback: ALTER TABLE ... DROP COLUMN IF EXISTS bank_bin
-- (drops the constraint with it).

ALTER TABLE public.platform_bank_accounts
  ADD COLUMN IF NOT EXISTS bank_bin text;

-- Format guard: a 6-digit NAPAS BIN, or NULL. Stops the UI ever writing 'MB' / '970422 ' / garbage.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_bank_accounts_bank_bin_format'
      AND conrelid = 'public.platform_bank_accounts'::regclass
  ) THEN
    ALTER TABLE public.platform_bank_accounts
      ADD CONSTRAINT platform_bank_accounts_bank_bin_format
      CHECK (bank_bin IS NULL OR bank_bin ~ '^[0-9]{6}$');
  END IF;
END $$;
