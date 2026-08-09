import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  callbackDestination,
  markInvitePasswordSetupRequired,
  parseOpsCallback,
  stripOpsAuthArtifacts,
} from "@/ops/auth/opsInviteCompletion";

type CallbackClient = ReturnType<typeof useSupabaseClient>;
type CallbackResult = {
  authError: Error | null;
  destination: string;
  invite: boolean;
};
let callbackAttempt: { url: string; promise: Promise<CallbackResult> } | null =
  null;

async function completeCallback(
  client: CallbackClient,
): Promise<CallbackResult> {
  const url = window.location.href;
  if (callbackAttempt?.url === url) return callbackAttempt.promise;
  const promise = (async () => {
    const intent = parseOpsCallback(url);
    let authError: Error | null = null;
    if (intent.kind === "pkce") {
      const result = await client.auth.exchangeCodeForSession(intent.code!);
      authError = result.error;
    } else if (intent.kind === "token_hash") {
      const result = await client.auth.verifyOtp({
        token_hash: intent.tokenHash!,
        type: intent.authType as
          | "recovery"
          | "email"
          | "invite"
          | "magiclink"
          | "email_change",
      });
      authError = result.error;
    } else if (intent.kind === "implicit") {
      const result = await client.auth.setSession({
        access_token: intent.accessToken!,
        refresh_token: intent.refreshToken!,
      });
      authError = result.error;
    } else if (intent.kind === "invalid") {
      authError = new Error("invalid callback");
    } else {
      const result = await client.auth.getSession();
      if (result.error || !result.data.session) {
        authError = result.error ?? new Error("missing session");
      }
    }
    return {
      authError,
      destination: callbackDestination(intent),
      invite: intent.authType === "invite",
    };
  })();
  callbackAttempt = { url, promise };
  return promise;
}

export default function OpsAuthCallback() {
  const client = useSupabaseClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { authError, destination, invite } = await completeCallback(client);
      if (!active) return;
      if (authError) {
        setError(
          "Link đăng nhập hoặc khôi phục không hợp lệ. Vui lòng yêu cầu link mới.",
        );
        return;
      }
      if (invite) markInvitePasswordSetupRequired();
      // OAuth/OTP tokens are never kept in browser history or app route state.
      window.history.replaceState(
        {},
        document.title,
        stripOpsAuthArtifacts(window.location.href),
      );
      navigate(destination, { replace: true });
    })();
    return () => {
      active = false;
    };
  }, [client, navigate]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 text-white">
      {error
        ? (
          <div className="max-w-md text-center">
            <p className="text-rose-300">{error}</p>
            <button
              className="mt-4 min-h-11 text-emerald-300 underline"
              onClick={() => navigate("/ops/login", { replace: true })}
            >
              Về đăng nhập Ops
            </button>
          </div>
        )
        : (
          <div className="flex items-center gap-3 text-zinc-300">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
            Đang xác nhận phiên Ops…
          </div>
        )}
    </main>
  );
}
