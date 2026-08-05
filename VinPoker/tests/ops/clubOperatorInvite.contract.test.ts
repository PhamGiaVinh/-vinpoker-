import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20270107000001_ops_club_operator_invites.sql",
  ),
  "utf8",
);
const edge = readFileSync(
  resolve(root, "supabase/functions/ops-club-accounts/index.ts"),
  "utf8",
);

describe("Ops club operator invitation boundary", () => {
  it("permits only club-scoped Floor and Cashier invitations", () => {
    expect(migration).toContain("operator_role IN ('floor', 'cashier')");
    expect(edge).toContain('value === "floor" || value === "cashier"');
    expect(edge).not.toContain('"owner"');
    expect(edge).not.toContain('.from("user_roles")');
  });

  it("keeps browser writes out of the invitation ledger and validates Owner server-side", () => {
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.club_operator_invites FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.club_operator_invites TO authenticated",
    );
    expect(edge).toContain('.eq("owner_id", actorId)');
    expect(edge).toContain("authenticateUser(req)");
    expect(edge).toContain("inviteUserByEmail");
    expect(edge).toContain('admin.rpc("apply_club_operator_invite"');
    expect(edge).toContain('admin.rpc("revoke_club_operator_invite"');
    expect(edge).not.toContain(".from(membershipTable)");
    expect(edge).not.toContain('.from("club_operator_invites")');
  });

  it("uses an explicit HTTPS Ops callback and revokes exact club membership only", () => {
    expect(edge).toContain('env.get("OPS_INVITE_REDIRECT_TO")');
    expect(edge).toContain('url.pathname === "/ops/auth/callback"');
    expect(edge).toContain("OPS_INVITE_EXPECTED_ORIGIN");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_club_operator_invite",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.revoke_club_operator_invite",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.apply_club_operator_invite",
    );
    expect(migration).toContain("TO service_role");
  });
});
