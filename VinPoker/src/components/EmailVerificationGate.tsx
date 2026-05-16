import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Public paths that don't require an email-confirmed account.
const PUBLIC_PATHS = ["/", "/auth", "/verify-email", "/terms", "/privacy", "/setup-davinci"];

/**
 * Gates the app for users who signed up but haven't confirmed their email.
 * Also fires the welcome email exactly once after first confirmation.
 */
export const EmailVerificationGate = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const welcomeSentRef = useRef(false);

  useEffect(() => {
    if (loading || !user) return;

    const confirmed = !!user.email_confirmed_at;
    const path = location.pathname;
    const isPublic =
      PUBLIC_PATHS.includes(path) ||
      path.startsWith("/terms") ||
      path.startsWith("/privacy");

    if (!confirmed && !isPublic) {
      nav("/verify-email", { replace: true });
      return;
    }

    // First-confirmation welcome email (idempotent server-side).
    if (confirmed && !welcomeSentRef.current) {
      welcomeSentRef.current = true;
      supabase.functions.invoke("send-welcome-email").catch(() => {
        // silent — server is idempotent and we'll retry next session
      });
    }
  }, [user, loading, location.pathname, nav]);

  return null;
};
