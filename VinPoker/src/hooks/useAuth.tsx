import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { linkUser, logoutUser } from "@/lib/onesignal";
import { deriveIsChipMaster } from "@/lib/chipMaster";
import { deriveIsMarketing } from "@/lib/marketer";

// HMR safety: AuthContext identity must stay stable across hot updates.
// If this module (or any of its imports) is hot-reloaded, force a full
// page reload so the AuthProvider and all consumers share one context.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}

type AppRole = "player" | "club_admin" | "super_admin" | "cashier" | "club_cashier" | "media" | "tracker" | "marketing";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isClubAdmin: boolean;
  isClubOwner: boolean; // owns >=1 club (clubs.owner_id) — independent of the club_admin role
  isCashier: boolean;
  isStaffOps: boolean; // super_admin OR cashier — can access staking ops
  isMedia: boolean; // media role
  isMediaOrAdmin: boolean; // can manage CMS / support
  isTracker: boolean; // tracker role — can access live tracker
  isDealer: boolean; // linked to a dealers row (dealers.user_id = auth.uid())
  isChipMaster: boolean; // Chip-Master of >=1 club (club_chip_masters) — flag-gated + guarded
  isMarketing: boolean; // marketing role or member of >=1 club (club_marketers) — flag-gated + guarded; NAV AFFORDANCE ONLY (data authority = marketer_club_ids RLS)
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isClubOwner, setIsClubOwner] = useState(false);
  const [isDealer, setIsDealer] = useState(false);
  const [isChipMaster, setIsChipMaster] = useState(false);
  const [isMarketingMember, setIsMarketingMember] = useState(false);
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
        setIsClubOwner(false);
        setIsDealer(false);
        setIsChipMaster(false);
        setIsMarketingMember(false);
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
    const [{ data: roleRows }, { data: ownedClubs }, { data: dealerRows }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("clubs").select("id").eq("owner_id", userId).limit(1),
      // A user "is a dealer" if linked to a dealers row. Self-read is permitted by
      // the dealers_select_control policy (USING ... OR auth.uid() = user_id).
      supabase.from("dealers").select("id").eq("user_id", userId).is("deleted_at", null).limit(1),
    ]);
    setRoles((roleRows ?? []).map((r: any) => r.role as AppRole));
    setIsClubOwner((ownedClubs ?? []).length > 0);
    setIsDealer((dealerRows ?? []).length > 0);
    // Chip-Master is additive + flag-gated + guarded (returns false without querying while
    // FEATURES.chipOps is off / on any error) so it never blocks or breaks auth init.
    deriveIsChipMaster(userId).then(setIsChipMaster).catch(() => setIsChipMaster(false));
    // Marketing membership — same guarded pattern (false without querying while
    // FEATURES.marketingModule is off / on any error). See lib/marketer.ts.
    deriveIsMarketing(userId).then(setIsMarketingMember).catch(() => setIsMarketingMember(false));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
    setIsClubOwner(false);
    setIsDealer(false);
    setIsChipMaster(false);
    setIsMarketingMember(false);
  };

  return (
    <AuthContext.Provider value={{
      session, user, roles, loading, signOut,
      isAdmin: roles.includes("super_admin"),
      isClubAdmin: roles.includes("club_admin") || roles.includes("super_admin"),
      isClubOwner,
      isCashier: roles.includes("cashier") || roles.includes("club_cashier"),
      isStaffOps: roles.includes("super_admin") || roles.includes("cashier") || roles.includes("club_cashier"),
      isMedia: roles.includes("media"),
      isMediaOrAdmin: roles.includes("super_admin") || roles.includes("media"),
      isTracker: roles.includes("tracker"),
      isDealer,
      isChipMaster,
      // Role OR super_admin OR club membership — NAV AFFORDANCE ONLY. Every marketing data read
      // is still filtered by marketer_club_ids()/RLS, so a global 'marketing' role is never a
      // read-all-clubs grant.
      isMarketing: roles.includes("marketing") || roles.includes("super_admin") || isMarketingMember,
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
