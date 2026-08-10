import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { opsClient } from "@/integrations/supabase/opsClient";

type OpsAuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOutCurrentSession: () => Promise<string | null>;
};

const OpsAuthContext = createContext<OpsAuthContextValue | null>(null);

export function OpsAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void opsClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(error ? null : data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = opsClient.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOutCurrentSession = useCallback(async () => {
    try {
      const { error } = await opsClient.auth.signOut({ scope: "local" });
      if (error) return "Không thể đăng xuất phiên hiện tại. Vui lòng thử lại.";
      setSession(null);
      return null;
    } catch {
      return "Không thể đăng xuất phiên hiện tại. Vui lòng thử lại.";
    }
  }, []);

  const value = useMemo<OpsAuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOutCurrentSession,
    }),
    [loading, session, signOutCurrentSession],
  );

  return (
    <SupabaseClientProvider client={opsClient}>
      <OpsAuthContext.Provider value={value}>{children}</OpsAuthContext.Provider>
    </SupabaseClientProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsAuth(): OpsAuthContextValue {
  const value = useContext(OpsAuthContext);
  if (!value) throw new Error("useOpsAuth must be used inside OpsAuthProvider.");
  return value;
}
