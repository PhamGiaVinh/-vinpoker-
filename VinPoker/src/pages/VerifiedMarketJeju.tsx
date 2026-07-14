import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";

const VerifiedMarketJejuContent = lazy(() =>
  import("@/components/series-market/VerifiedMarketJejuContent")
    .then((module) => ({ default: module.VerifiedMarketJejuContent })),
);

export default function VerifiedMarketJeju() {
  const { loading, isAdmin, isClubAdmin, isClubOwner } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        Checking access...
      </div>
    );
  }
  if (!(isAdmin || isClubAdmin || isClubOwner)) return <Navigate to="/" replace />;
  if (!FEATURES.seriesMarketVerifiedJeju && !isAdmin) return <Navigate to="/club/admin" replace />;
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading Public Evidence...</div>}>
      <VerifiedMarketJejuContent />
    </Suspense>
  );
}
