import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) => readFileSync(
  resolve(process.cwd(), `supabase/pending-migrations/${name}`),
  "utf8",
).replace(/\r\n/g, "\n");

const migration = readMigration("20260924065041_tv_layout_editor_v1.sql");
const releaseGateMigration = readMigration("20260924165219_centerpoint_tournament_ops_release_v1.sql");
const scopedMigration = readMigration("20270118000001_tv_tournament_layout_v2.sql");
const multiblockMigration = readMigration("20270119000000_tv_layout_editor_multiblock_v3.sql");
const storageGateStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(",
);
const storageGateEnd = migration.indexOf("\n$$;", storageGateStart);
const storageGate = migration.slice(storageGateStart, storageGateEnd);

describe("TV layout migration architecture", () => {
  it("restrictively gates only own versioned TV assets through the enabled club allowlist", () => {
    expect(storageGateStart).toBeGreaterThanOrEqual(0);
    expect(storageGate).toContain("p_bucket_id IS DISTINCT FROM 'backing-proofs'");
    expect(storageGate).toContain("unnest(r.allowed_club_ids) AS allowlisted(club_id)");
    expect(storageGate).toContain("centerpoint_private.tournament_ops_release_allowed_v1(allowlisted.club_id)");
    expect(storageGate).toContain("public.is_club_dealer_control((SELECT auth.uid()), allowlisted.club_id)");
    expect(storageGate).toContain("(storage.foldername(p_name))[1] = (SELECT auth.uid())::text");
    expect(migration).toContain("ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated");
    expect(migration).toContain("WITH CHECK (\n    centerpoint_private.tv_branding_storage_insert_allowed_v1(bucket_id, name)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)\n  TO authenticated");
  });

  it("denies TV uploads while release is OFF and allows only authorized actors for listed clubs when ON", () => {
    expect(releaseGateMigration).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(releaseGateMigration).toContain("SELECT r.enabled");
    expect(releaseGateMigration).toContain("p_club_id = ANY(r.allowed_club_ids)");
    expect(storageGate).toContain("centerpoint_private.tournament_ops_release_allowed_v1(allowlisted.club_id)");
    expect(storageGate).toContain("r.allowed_club_ids");
    expect(storageGate).toContain("allowlisted.club_id");
    expect(storageGate).toContain("public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)");
    expect(storageGate).toContain("public.is_club_dealer_control((SELECT auth.uid()), allowlisted.club_id)");
    expect(storageGate).toContain("      false\n    )");
  });

  it("rejects another user's UID path", () => {
    expect(storageGate).toContain("(storage.foldername(p_name))[1] = (SELECT auth.uid())::text");
    expect(storageGate).not.toContain("p_club_id");
  });

  it("does not narrow non-TV paths or other buckets", () => {
    expect(storageGate).toContain("WHEN p_bucket_id IS DISTINCT FROM 'backing-proofs'");
    expect(storageGate).toContain("OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/tv/branding-(logo|background)/v1/");
    expect(storageGate).toContain("THEN true");
  });

  it("binds writes to the authenticated TV operator and validates layout server-side", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.is_club_dealer_control(v_actor, p_club_id)");
    expect(migration).toContain("public.is_valid_tv_layout_config(p_layout)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.is_valid_tv_layout_config(jsonb) TO authenticated, service_role");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1");
  });

  it("keeps paired TV output sanitized and token-bound", () => {
    expect(migration).toContain("v_payload := public.get_tv_display_state(p_display_token)");
    expect(migration).toContain("WHERE d.display_token = p_display_token");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v2(text) TO anon, authenticated");
  });
});

describe("TV layout tournament scope follow-up", () => {
  it("retires the club writer and binds new writes to an event or tournament with revision", () => {
    expect(scopedMigration).toContain("REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1");
    expect(scopedMigration).toContain("tv_tournament_layout_one_event_v2");
    expect(scopedMigration).toContain("tv_tournament_layout_one_tournament_v2");
    expect(scopedMigration).toContain("coalesce(v_existing.revision, 0) <> p_expected_revision");
    expect(scopedMigration).toContain("public.is_club_floor(v_actor, v_tour.club_id)");
    expect(scopedMigration).toContain("ALTER TABLE public.tv_tournament_layouts ENABLE ROW LEVEL SECURITY");
  });

  it("gates the V1 per-club save RPC after actor and club authorization", () => {
    const writerStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.save_tv_branding_layout_v1(");
    const writerEnd = migration.indexOf("\n$$;", writerStart);
    const writerBody = migration.slice(writerStart, writerEnd);
    const permissionCheck = writerBody.indexOf("public.is_club_dealer_control(v_actor, p_club_id)");
    const releaseGate = writerBody.indexOf("PERFORM centerpoint_private.assert_tournament_ops_release_v1(p_club_id)");

    expect(writerStart).toBeGreaterThanOrEqual(0);
    expect(permissionCheck).toBeGreaterThanOrEqual(0);
    expect(releaseGate).toBeGreaterThan(permissionCheck);
  });

  it("gates the V2 save RPC after actor and club authorization", () => {
    const writerStart = scopedMigration.indexOf("CREATE OR REPLACE FUNCTION public.save_tv_tournament_layout_v1(");
    const writerEnd = scopedMigration.indexOf("\n$$;", writerStart);
    const writerBody = scopedMigration.slice(writerStart, writerEnd);
    const permissionCheck = writerBody.indexOf("RAISE EXCEPTION 'tv_layout_forbidden'");
    const releaseGate = writerBody.indexOf("PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tour.club_id)");

    expect(writerStart).toBeGreaterThanOrEqual(0);
    expect(permissionCheck).toBeGreaterThanOrEqual(0);
    expect(releaseGate).toBeGreaterThan(permissionCheck);
  });

  it("keeps paired TV reads tied to its assigned tournament and emits branding only", () => {
    expect(scopedMigration).toContain("WHERE display_token = p_display_token AND status = 'paired'");
    expect(scopedMigration).toContain("public.get_tv_tournament_branding_v1(v_tournament_id)");
    expect(scopedMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v3(text) TO anon,authenticated");
  });
});

describe("TV layout v3 server and asset contract", () => {
  it("gates the V3 publish RPC after actor and club authorization", () => {
    const writerStart = multiblockMigration.indexOf("CREATE OR REPLACE FUNCTION public.save_tv_tournament_layout_v1(");
    const writerEnd = multiblockMigration.indexOf("\n$$;", writerStart);
    const writerBody = multiblockMigration.slice(writerStart, writerEnd);
    const permissionCheck = writerBody.indexOf("RAISE EXCEPTION 'tv_layout_forbidden'");
    const releaseGate = writerBody.indexOf("PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tour.club_id)");

    expect(writerStart).toBeGreaterThanOrEqual(0);
    expect(permissionCheck).toBeGreaterThanOrEqual(0);
    expect(releaseGate).toBeGreaterThan(permissionCheck);
  });

  it("validates full text and logo boxes against the same safe bounds and fixed regions as the client", () => {
    expect(multiblockMigration).toContain("(p_value->>'brand_x')::numeric NOT BETWEEN 8 AND 92");
    expect(multiblockMigration).toContain("(p_value->>'brand_y')::numeric NOT BETWEEN 4 AND 96");
    expect(multiblockMigration).toContain("(p_value->>'brand_scale')::numeric NOT BETWEEN 70 AND 140");
    expect(multiblockMigration).toContain("(p_value->>'logo_scale')::numeric NOT BETWEEN 60 AND 150");
    expect(multiblockMigration).toContain("(p_value->>'background_x')::numeric NOT BETWEEN 0 AND 100");
    expect(multiblockMigration).toContain("(p_value->>'background_y')::numeric NOT BETWEEN 0 AND 100");
    expect(multiblockMigration).toContain("jsonb_array_length(p_value->'text_blocks') > 6");
    expect(multiblockMigration).toContain("v_left < 4 OR v_top < 4 OR v_right > 96 OR v_bottom > 96");
    expect(multiblockMigration).toContain("(v_left < 71 AND v_right > 29 AND v_top < 76 AND v_bottom > 24)");
    expect(multiblockMigration).toContain("(v_left < 34 AND v_right > 3 AND v_top < 84 AND v_bottom > 16)");
    expect(multiblockMigration).toContain("(v_left < 97 AND v_right > 66 AND v_top < 84 AND v_bottom > 16)");
  });

  it("accounts for logoScale in full bounding height near the safe edge", () => {
    expect(multiblockMigration).toContain("greatest(12, 9.6 * (p_value->>'logo_scale')::numeric / 100)");
    expect(multiblockMigration).toContain("v_brand_top < 4");
    expect(multiblockMigration).toContain("v_brand_bottom > 96");
    expect(multiblockMigration).toContain("OR (v_brand_left < 71 AND v_brand_right > 29 AND v_brand_top < 76 AND v_brand_bottom > 24)");
  });

  it("accepts the unchanged v2 legacy layout shape before applying v3-only geometry", () => {
    const legacyShape = multiblockMigration.indexOf("IF NOT (p_value ? 'text_blocks')");
    const v3Geometry = multiblockMigration.indexOf("v_brand_left :=");
    expect(scopedMigration).toContain("'brand_x',18,'brand_y',45");
    expect(legacyShape).toBeGreaterThanOrEqual(0);
    expect(legacyShape).toBeLessThan(v3Geometry);
    expect(multiblockMigration.slice(legacyShape, v3Geometry)).toContain("RETURN length(p_value->>'custom_text') <= 80");
  });

  it("keeps legacy custom_text readable and snapshots each successful publish immutably", () => {
    expect(multiblockMigration).toContain("IF NOT (p_value ? 'text_blocks')");
    expect(multiblockMigration).toContain("length(p_value->>'custom_text') <= 80");
    expect(multiblockMigration).toContain("CREATE TABLE IF NOT EXISTS public.tv_tournament_layout_versions");
    expect(multiblockMigration).toContain("tv_tournament_layout_versions_immutable");
    expect(multiblockMigration).toContain("INSERT INTO public.tv_tournament_layout_versions");
  });

  it("allows a first publish to retain exactly the loaded club fallback assets", () => {
    expect(multiblockMigration).toContain("SELECT c.tv_logo_url, coalesce(c.tv_bg_url, c.cover_url)");
    expect(multiblockMigration).toContain("CASE WHEN v_existing.id IS NULL THEN v_club_logo_url ELSE v_existing.logo_url END");
    expect(multiblockMigration).toContain("CASE WHEN v_existing.id IS NULL THEN v_club_background_url ELSE v_existing.background_url END");
    expect(multiblockMigration).toContain("p_logo_url = v_current_logo_url");
    expect(multiblockMigration).toContain("p_bg_url = v_current_background_url");
    expect(multiblockMigration).toContain("tv_layout_asset_missing");
  });

  it("requires versioned asset paths and prevents client updates/deletes to that namespace", () => {
    expect(multiblockMigration).toContain("branding-logo/v1/");
    expect(multiblockMigration).toContain("branding-background/v1/");
    expect(multiblockMigration).toContain("p_logo_url = v_current_logo_url");
    expect(multiblockMigration).toContain("p_bg_url = v_current_background_url");
    expect(multiblockMigration).toContain("private.is_tv_branding_asset_immutable_v1(bucket_id, name)");
    expect(multiblockMigration).toContain("GRANT USAGE ON SCHEMA private TO authenticated");
    expect(multiblockMigration).toContain("ALTER FUNCTION private.is_tv_branding_asset_immutable_v1(text,text) OWNER TO postgres");
    expect(multiblockMigration).toContain("FROM public.tv_tournament_layout_versions v");
    expect(multiblockMigration).toContain("FROM public.tv_tournament_layouts l");
    expect(multiblockMigration).toContain("AS RESTRICTIVE FOR UPDATE TO authenticated");
    expect(multiblockMigration).toContain("AS RESTRICTIVE FOR DELETE TO authenticated");
    expect(multiblockMigration).toContain("p_name ~ '^[0-9a-f-]{36}/tv/branding-(logo|background)/v1/[0-9a-f-]{36}[.](png|jpg)$'");
  });
});
