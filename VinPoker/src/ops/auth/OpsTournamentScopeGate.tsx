import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  floorScopeFingerprint,
  isCurrentTournamentScope,
  type VerifiedTournamentScope,
} from "@/ops/auth/opsTournamentScope";
import { OpsAccessDenied } from "@/ops/pages/OpsEntryResolver";

/**
 * Resolves a tournament only inside the caller-bound Floor club scope before
 * mounting any tournament data hook. The club-name metadata query is not part
 * of this authorization decision.
 */
export function OpsTournamentScopeGate({ children }: { children: ReactNode }) {
  const { id } = useParams();
  const client = useSupabaseClient();
  const { floorClubIds, loading, scopeError } = useOpsCapabilities();
  const scopeFingerprint = floorScopeFingerprint(floorClubIds);
  const [verification, setVerification] = useState<VerifiedTournamentScope>({
    status: "checking",
    tournamentId: null,
    scopeFingerprint: "",
  });

  useEffect(() => {
    if (loading) {
      setVerification({
        status: "checking",
        tournamentId: id ?? null,
        scopeFingerprint,
      });
      return;
    }
    if (scopeError || !id || floorClubIds.length === 0) {
      setVerification({
        status: "denied",
        tournamentId: id ?? null,
        scopeFingerprint,
      });
      return;
    }

    let cancelled = false;
    setVerification({
      status: "checking",
      tournamentId: id,
      scopeFingerprint,
    });
    void (async () => {
      try {
        const { data, error } = await client
          .from("tournaments")
          .select("id")
          .eq("id", id)
          .in("club_id", floorClubIds)
          .maybeSingle();
        if (cancelled) return;
        setVerification({
          status: !error && data?.id === id ? "allowed" : "denied",
          tournamentId: id,
          scopeFingerprint,
        });
      } catch {
        if (!cancelled) {
          setVerification({
            status: "denied",
            tournamentId: id,
            scopeFingerprint,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, floorClubIds, id, loading, scopeError, scopeFingerprint]);

  const verificationMatchesRoute = verification.tournamentId === (id ?? null)
    && verification.scopeFingerprint === scopeFingerprint;
  if (!verificationMatchesRoute || verification.status === "checking") {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center text-zinc-300">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
        Đang kiểm tra phạm vi giải đấu…
      </main>
    );
  }
  if (verification.status === "denied") {
    return <OpsAccessDenied message="Giải đấu không thuộc phạm vi Floor được cấp cho tài khoản này." />;
  }
  return isCurrentTournamentScope(verification, id, scopeFingerprint)
    ? <>{children}</>
    : null;
}
