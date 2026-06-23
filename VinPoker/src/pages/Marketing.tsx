import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { MarketingManager } from "@/components/marketing/MarketingManager";

const Marketing = () => {
  const { t } = useTranslation();
  const { loading, isMarketing, isClubOwner, isAdmin } = useAuth();

  if (loading) return null;
  // Role guard: marketers, club owners and super_admin only. (isMarketing already folds in
  // super_admin + the guarded club_marketers membership — see useAuth.)
  if (!(isMarketing || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 font-display text-xl text-foreground">{t("marketing.title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("marketing.subtitle")}</p>
      <MarketingManager />
    </div>
  );
};

// Flag-gated default export (mirrors ChipOpsInventory). While marketingModule is OFF the route
// redirects, so the screen never mounts until the feature is enabled.
export default FEATURES.marketingModule ? Marketing : (() => <Navigate to="/" replace />);
