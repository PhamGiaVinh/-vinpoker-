// Owner-gated Ops invitations. Browser sends intent only; server verifies Owner.
// Never writes user_roles and never accepts an Owner role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authenticateUser,
  corsHeaders,
  json,
  type SupabaseAdmin,
} from "../_shared/staking-common.ts";

type OperatorRole = "floor" | "cashier";
type InviteRequest = {
  action: "invite";
  club_id: string;
  email: string;
  operator_role: OperatorRole;
};
type RevokeRequest = { action: "revoke"; invite_id: string };

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
}
function isRole(value: unknown): value is OperatorRole {
  return value === "floor" || value === "cashier";
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function inviteRedirectTo(): string | null {
  const configured = Deno.env.get("OPS_INVITE_REDIRECT_TO");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && url.pathname === "/ops/auth/callback"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
async function findUserByEmail(admin: SupabaseAdmin, email: string) {
  // No client-supplied auth user ID; bound scan is the currently available Admin seam.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("AUTH_LOOKUP_FAILED");
    const match = data.users.find((candidate: { email?: string }) =>
      candidate.email?.toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("AUTH_LOOKUP_LIMIT");
}
async function isOwner(admin: SupabaseAdmin, clubId: string, actorId: string) {
  const { data, error } = await admin.from("clubs").select("id").eq(
    "id",
    clubId,
  ).eq("owner_id", actorId).maybeSingle();
  return !error && Boolean(data?.id);
}
async function writeAudit(
  admin: SupabaseAdmin,
  clubId: string,
  actorId: string,
  action: string,
  inviteId: string,
  role: OperatorRole,
) {
  await admin.from("audit_logs").insert({
    club_id: clubId,
    actor_id: actorId,
    action,
    entity_type: "club_operator_invite",
    entity_id: inviteId,
    payload: { operator_role: role },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = await authenticateUser(req);
  if (auth instanceof Response) return auth;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const body = await req.json().catch(() => null) as
      | InviteRequest
      | RevokeRequest
      | null;
    if (!body || typeof body !== "object") {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    if (body.action === "invite") {
      const email = normalizeEmail(body.email);
      if (!isUuid(body.club_id) || !isRole(body.operator_role) || !email) {
        return json({ error: "INVALID_REQUEST" }, 400);
      }
      if (!(await isOwner(admin, body.club_id, auth.uid))) {
        return json({ error: "FORBIDDEN" }, 403);
      }
      const redirectTo = inviteRedirectTo();
      if (!redirectTo) {
        return json({ error: "INVITE_CONFIGURATION_REQUIRED" }, 503);
      }
      let target = await findUserByEmail(admin, email);
      let invitationSent = false;
      if (!target) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(
          email,
          { redirectTo },
        );
        if (error || !data.user) {
          return json({ error: "INVITE_DELIVERY_FAILED" }, 502);
        }
        target = data.user;
        invitationSent = true;
      }
      const membershipTable = body.operator_role === "floor"
        ? "club_floors"
        : "club_cashiers";
      const { error: membershipError } = await admin.from(membershipTable)
        .upsert(
          { club_id: body.club_id, user_id: target.id, granted_by: auth.uid },
          { onConflict: "club_id,user_id", ignoreDuplicates: true },
        );
      if (membershipError) {
        return json({ error: "MEMBERSHIP_WRITE_FAILED" }, 500);
      }
      const now = new Date().toISOString();
      const { data: activeInvite } = await admin.from("club_operator_invites")
        .select("id").eq("club_id", body.club_id).eq("email_normalized", email)
        .eq("operator_role", body.operator_role).eq("status", "active")
        .maybeSingle();
      const inviteWrite = activeInvite?.id
        ? await admin.from("club_operator_invites").update({
          auth_user_id: target.id,
          invited_by: auth.uid,
          updated_at: now,
        }).eq("id", activeInvite.id).select("id").single()
        : await admin.from("club_operator_invites").insert({
          club_id: body.club_id,
          email_normalized: email,
          operator_role: body.operator_role,
          auth_user_id: target.id,
          invited_by: auth.uid,
          status: "active",
          updated_at: now,
        }).select("id").single();
      const { data: invite, error: inviteError } = inviteWrite;
      if (inviteError || !invite?.id) {
        return json({ error: "INVITE_RECORD_FAILED" }, 500);
      }
      await writeAudit(
        admin,
        body.club_id,
        auth.uid,
        invitationSent
          ? "ops_operator_invited"
          : "ops_operator_granted_existing",
        invite.id,
        body.operator_role,
      );
      return json({
        status: invitationSent ? "INVITED" : "GRANTED_EXISTING",
        invite_id: invite.id,
      });
    }
    if (body.action === "revoke") {
      if (!isUuid(body.invite_id)) {
        return json({ error: "INVALID_REQUEST" }, 400);
      }
      const { data: invite, error: inviteError } = await admin.from(
        "club_operator_invites",
      )
        .select("id,club_id,auth_user_id,operator_role,status").eq(
          "id",
          body.invite_id,
        ).maybeSingle();
      if (inviteError || !invite) return json({ error: "NOT_FOUND" }, 404);
      if (!(await isOwner(admin, invite.club_id, auth.uid))) {
        return json({ error: "FORBIDDEN" }, 403);
      }
      if (invite.status === "revoked") {
        return json({ status: "ALREADY_REVOKED" });
      }
      if (invite.auth_user_id) {
        const membershipTable = invite.operator_role === "floor"
          ? "club_floors"
          : "club_cashiers";
        const { error } = await admin.from(membershipTable).delete().eq(
          "club_id",
          invite.club_id,
        ).eq("user_id", invite.auth_user_id);
        if (error) return json({ error: "MEMBERSHIP_REVOKE_FAILED" }, 500);
      }
      const { error: revokeError } = await admin.from("club_operator_invites")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: auth.uid,
          updated_at: new Date().toISOString(),
        }).eq("id", invite.id).eq("status", "active");
      if (revokeError) return json({ error: "REVOKE_RECORD_FAILED" }, 500);
      await writeAudit(
        admin,
        invite.club_id,
        auth.uid,
        "ops_operator_revoked",
        invite.id,
        invite.operator_role as OperatorRole,
      );
      return json({ status: "REVOKED" });
    }
    return json({ error: "INVALID_REQUEST" }, 400);
  } catch (error) {
    return json({
      error: error instanceof Error && error.message === "AUTH_LOOKUP_LIMIT"
        ? "AUTH_LOOKUP_LIMIT"
        : "INTERNAL_ERROR",
    }, 500);
  }
});
