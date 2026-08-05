export const opsInvitePasswordSetupKey = "vinpoker.ops.invite-password-setup";

type CallbackKind = "pkce" | "token_hash" | "implicit" | "session" | "invalid";

export type OpsCallbackIntent = {
  kind: CallbackKind;
  authType: string | null;
  code: string | null;
  tokenHash: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  next: string;
};

function safeNext(value: string | null): string {
  return value?.startsWith("/ops") ? value : "/ops";
}

export function parseOpsCallback(href: string): OpsCallbackIntent {
  const url = new URL(href);
  const query = url.searchParams;
  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  );
  const authType = query.get("type") ?? fragment.get("type");
  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (code) {
    return {
      kind: "pkce",
      authType,
      code,
      tokenHash: null,
      accessToken: null,
      refreshToken: null,
      next: safeNext(query.get("next")),
    };
  }
  if (tokenHash && authType) {
    return {
      kind: "token_hash",
      authType,
      code: null,
      tokenHash,
      accessToken: null,
      refreshToken: null,
      next: safeNext(query.get("next")),
    };
  }
  if (accessToken && refreshToken) {
    return {
      kind: "implicit",
      authType,
      code: null,
      tokenHash: null,
      accessToken,
      refreshToken,
      next: safeNext(query.get("next")),
    };
  }
  if (fragment.get("error_code") || fragment.get("error_description")) {
    return {
      kind: "invalid",
      authType,
      code: null,
      tokenHash: null,
      accessToken: null,
      refreshToken: null,
      next: safeNext(query.get("next")),
    };
  }
  return {
    kind: "session",
    authType,
    code: null,
    tokenHash: null,
    accessToken: null,
    refreshToken: null,
    next: safeNext(query.get("next")),
  };
}

export function callbackDestination(intent: OpsCallbackIntent): string {
  return intent.authType === "invite"
    ? "/ops/account?mode=reset-password&source=invite"
    : intent.authType === "recovery"
    ? "/ops/account?mode=reset-password"
    : intent.next;
}

export function stripOpsAuthArtifacts(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function requiresInvitePasswordSetup(): boolean {
  return window.sessionStorage.getItem(opsInvitePasswordSetupKey) ===
    "required";
}

export function markInvitePasswordSetupRequired(): void {
  window.sessionStorage.setItem(opsInvitePasswordSetupKey, "required");
}

export function clearInvitePasswordSetupRequired(): void {
  window.sessionStorage.removeItem(opsInvitePasswordSetupKey);
}
