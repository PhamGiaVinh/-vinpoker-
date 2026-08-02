import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

function safeNext(value: string | null): string {
  return value?.startsWith("/ops") ? value : "/ops";
}

type CallbackClient = ReturnType<typeof useSupabaseClient>;
type CallbackResult = { authError: Error | null; next: string };
let callbackAttempt: { url: string; promise: Promise<CallbackResult> } | null = null;

function completeCallback(client: CallbackClient): Promise<CallbackResult> {
  const url = window.location.href;
  if (callbackAttempt?.url === url) return callbackAttempt.promise;

  const promise = (async () => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNext(params.get("next"));
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type");

    let authError: Error | null = null;
    if (code) {
      const result = await client.auth.exchangeCodeForSession(code);
      authError = result.error;
    } else if (tokenHash && type) {
      const result = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as "recovery" | "email" | "invite" | "magiclink" | "email_change",
      });
      authError = result.error;
    } else {
      const result = await client.auth.getSession();
      if (result.error || !result.data.session) {
        authError = result.error ?? new Error("missing session");
      }
    }
    return { authError, next };
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
      const { authError, next } = await completeCallback(client);
      if (!active) return;
      if (authError) {
        setError("Link đăng nhập hoặc khôi phục không hợp lệ. Vui lòng yêu cầu link mới.");
        return;
      }
      navigate(next, { replace: true });
    })();
    return () => {
      active = false;
    };
  }, [client, navigate]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 text-white">
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-rose-300">{error}</p>
          <button className="mt-4 min-h-11 text-emerald-300 underline" onClick={() => navigate("/ops/login", { replace: true })}>
            Về đăng nhập Ops
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-zinc-300">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
          Đang xác nhận phiên Ops…
        </div>
      )}
    </main>
  );
}
