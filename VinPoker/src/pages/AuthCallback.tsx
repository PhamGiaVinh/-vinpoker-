import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

const AuthCallback = () => {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    (async () => {
      const token_hash = sp.get("token_hash");
      const type = sp.get("type") as "signup" | "email_change" | "recovery" | "invite" | undefined;
      const next = sp.get("next") ?? "/";

      if (!token_hash || !type) {
        setStatus("error");
        setTimeout(() => nav("/auth"), 2000);
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type ?? "signup",
      });

      if (error) {
        setStatus("error");
        setTimeout(() => nav("/auth"), 3000);
        return;
      }

      setStatus("success");
      setTimeout(() => nav(next, { replace: true }), 1500);
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        {status === "loading" && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Đang xác thực email...</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <p className="text-success font-semibold">Xác thực email thành công!</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="text-destructive font-semibold">Liên kết xác thực không hợp lệ hoặc đã hết hạn.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
