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
const account = readFileSync(resolve(root, "src/ops/pages/OpsAccount.tsx"), "utf8");
const disposableWorkflow = readFileSync(
  resolve(root, "../.github/workflows/ops-club-operator-invites-disposable-db.yml"),
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

  it("keeps email-backed grants pending until the authenticated recipient accepts", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.accept_my_club_operator_invites()");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toContain("EMAIL_CONFIRMATION_REQUIRED");
    expect(migration).toContain("AUTH_USER_UNCONFIRMED");
    expect(migration).toContain("ops_operator_invite_accepted");
    expect(migration).toContain("IF v_status = 'active' THEN");
    expect(migration).toContain("p_invitation_sent THEN 'pending'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.accept_my_club_operator_invites() TO authenticated");
    expect(account).toContain('client.rpc("accept_my_club_operator_invites")');
    expect(account).toContain("capabilities.refresh()");
    expect(account).toContain("Hoàn tất kích hoạt tài khoản");
  });

  it("runs the exact migration against disposable PostgreSQL without Supabase credentials", () => {
    expect(disposableWorkflow).toContain("image: postgres:16");
    expect(disposableWorkflow).toContain("ON_ERROR_STOP=1");
    expect(disposableWorkflow).toContain("tests/ops/disposableDb.integration.sql");
    expect(disposableWorkflow).not.toContain("SUPABASE_");
  });
});
