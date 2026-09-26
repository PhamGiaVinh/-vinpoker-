-- Disposable restore compatibility only. Never applied to production.
-- Source: supabase/auth commit ce9a8eee0cc042be8c7a42981a7ddae631e41d91
-- Upstream migrations: 20260821000000, 20260821010000, 20260824000000,
-- 20260824000001, 20260831180000, 20260911120000.

SET ROLE supabase_auth_admin;

CREATE TABLE IF NOT EXISTS auth.scim_users (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL REFERENCES auth.sso_providers (id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    resource jsonb NOT NULL,
    user_name text NOT NULL GENERATED ALWAYS AS (lower(resource->>'userName')) STORED,
    external_id text GENERATED ALWAYS AS (resource->>'externalId') STORED,
    active boolean NOT NULL GENERATED ALWAYS AS (coalesce((resource->>'active')::boolean, true)) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT scim_users_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_users_user_name_key
    ON auth.scim_users (sso_provider_id, user_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS scim_users_external_id_key
    ON auth.scim_users (sso_provider_id, external_id)
    WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scim_users_user_id_idx ON auth.scim_users (user_id);
CREATE INDEX IF NOT EXISTS scim_users_id_idx
    ON auth.scim_users (sso_provider_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scim_users_user_name_idx
    ON auth.scim_users (sso_provider_id, user_name COLLATE "C", id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scim_users_created_at_idx
    ON auth.scim_users (sso_provider_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scim_users_updated_at_idx
    ON auth.scim_users (sso_provider_id, updated_at, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scim_users_sso_provider_id_idx ON auth.scim_users (sso_provider_id);
CREATE INDEX IF NOT EXISTS scim_users_deleted_at_idx ON auth.scim_users (deleted_at);

CREATE TABLE IF NOT EXISTS auth.scim_tokens (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL REFERENCES auth.sso_providers (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    prefix text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz,
    CONSTRAINT scim_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT scim_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scim_tokens_expires_at_future CHECK (expires_at IS NULL OR expires_at > created_at),
    CONSTRAINT scim_tokens_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_tokens_token_hash_key ON auth.scim_tokens (token_hash);
CREATE INDEX IF NOT EXISTS scim_tokens_sso_provider_id_idx ON auth.scim_tokens (sso_provider_id);
CREATE INDEX IF NOT EXISTS scim_tokens_expires_at_idx ON auth.scim_tokens (expires_at);
CREATE INDEX IF NOT EXISTS scim_tokens_revoked_at_idx ON auth.scim_tokens (revoked_at);

DO $$ BEGIN
    ALTER TYPE auth.factor_type ADD VALUE 'recovery_code';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth.mfa_recovery_code_sets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
    mfa_factor_id uuid NOT NULL UNIQUE REFERENCES auth.mfa_factors (id) ON DELETE CASCADE,
    failed_verification_count integer NOT NULL DEFAULT 0 CHECK (failed_verification_count >= 0),
    verification_locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.mfa_recovery_codes (
    id uuid PRIMARY KEY,
    mfa_recovery_code_set_id uuid NOT NULL REFERENCES auth.mfa_recovery_code_sets (id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_set_id_idx
    ON auth.mfa_recovery_codes (mfa_recovery_code_set_id);

ALTER TABLE auth.one_time_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE auth.one_time_tokens ADD COLUMN IF NOT EXISTS link_token_hash text;
DO $$ BEGIN
    BEGIN
        CREATE INDEX IF NOT EXISTS one_time_tokens_link_token_hash_hash_idx
            ON auth.one_time_tokens USING hash (link_token_hash);
    EXCEPTION WHEN OTHERS THEN
        CREATE INDEX IF NOT EXISTS one_time_tokens_link_token_hash_hash_idx
            ON auth.one_time_tokens USING btree (link_token_hash);
    END;
END $$;

RESET ROLE;
