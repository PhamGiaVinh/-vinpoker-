import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { linkUser, logoutUser } from "@/lib/onesignal";

// HMR safety: AuthContext identity must stay stable across hot updates.
// If this module (or any of its imports) is hot-reloaded, force a full
// page reload so the AuthProvider and all consumers share one context.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}

type AppRole = "player" | "club_admin" | "super_admin" | "cashier" | "club_cashier" | "media" | "tracker";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isClubAdmin: boolean;
  isCashier: boolean;
  isStaffOps: boolean; // super_admin OR cashier — can access staking ops
  isMedia: boolean; // media role
  isMediaOrAdmin: boolean; // can manage CMS / support
  isTracker: boolean; // tracker role — can access live tracker
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => fetchRoles(sess.user.id), 0);
        setTimeout(() => {
          linkUser(sess.user.id);
          // Persist OneSignal external_id mapping (idempotent)
          supabase
            .from("profiles")
            .update({ onesignal_external_user_id: sess.user.id })
            .eq("user_id", sess.user.id)
            .then(() => {});
        }, 0);
      } else {
        setRoles([]);
        setTimeout(() => logoutUser(), 0);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) { fetchRoles(sess.user.id); linkUser(sess.user.id); }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    setRoles((data ?? []).map((r: any) => r.role as AppRole));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
  };

  return (
    <AuthContext.Provider value={{
      session, user, roles, loading, signOut,
      isAdmin: roles.includes("super_admin"),
      isClubAdmin: roles.includes("club_admin") || roles.includes("super_admin"),
      isCashier: roles.includes("cashier") || roles.includes("club_cashier"),
      isStaffOps: roles.includes("super_admin") || roles.includes("cashier") || roles.includes("club_cashier"),
      isMedia: roles.includes("media"),
      isMediaOrAdmin: roles.includes("super_admin") || roles.includes("media"),
      isTracker: roles.includes("tracker"),
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
