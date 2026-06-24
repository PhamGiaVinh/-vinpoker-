import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Shield, Newspaper, Image as ImageIcon, Trophy, CalendarDays, LifeBuoy, Globe } from "lucide-react";
import { Loader2 } from "lucide-react";
import { BannersEditor, SeriesEditor } from "./SuperAdmin";
import { AdminSupportTab } from "@/components/admin/AdminSupportTab";
import { MediaClubSchedules } from "@/components/admin/MediaClubSchedules";
import { TournamentPhotosManager } from "@/components/admin/TournamentPhotosManager";
import News from "./News";
import InternationalEvents from "./InternationalEvents";

const MediaCenter = () => {
  const { t } = useTranslation();
  const { user, loading, isMediaOrAdmin, isFloor } = useAuth();

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  // Media/admin get the full CMS; a pure-floor user is allowed in for the photos tab only.
  if (!isMediaOrAdmin && !isFloor) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">{t("mediaCenterPage.noPermissionTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("mediaCenterPage.noPermissionDesc")}</p>
    </Card>
  );

  // CMS (news/banners/series/etc.) is media/admin-only. Floor-only users see just "Ảnh giải đấu".
  const canCms = isMediaOrAdmin;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-[hsl(var(--ds-preassign))]" />
        <div>
          <h1 className="font-display text-2xl text-[hsl(var(--ds-preassign))]">{t("mediaCenterPage.heading")}</h1>
          <p className="text-xs text-muted-foreground">{t("mediaCenterPage.subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue={canCms ? "news" : "photos"}>
        <div className="overflow-x-auto -mx-2 px-2 pb-1">
          <TabsList className="inline-flex w-max min-w-full">
            {canCms && <TabsTrigger value="news" className="text-xs"><Newspaper className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabNews")}</TabsTrigger>}
            {canCms && <TabsTrigger value="banners" className="text-xs"><ImageIcon className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabBanners")}</TabsTrigger>}
            {canCms && <TabsTrigger value="series" className="text-xs"><Trophy className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSeries")}</TabsTrigger>}
            {canCms && <TabsTrigger value="international" className="text-xs"><Globe className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabInternational")}</TabsTrigger>}
            {canCms && <TabsTrigger value="schedules" className="text-xs"><CalendarDays className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSchedules")}</TabsTrigger>}
            <TabsTrigger value="photos" className="text-xs"><ImageIcon className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabPhotos", "Ảnh giải đấu")}</TabsTrigger>
            {canCms && <TabsTrigger value="support" className="text-xs"><LifeBuoy className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSupport")}</TabsTrigger>}
          </TabsList>
        </div>

        {canCms && <TabsContent value="news" className="mt-4"><News /></TabsContent>}
        {canCms && <TabsContent value="banners" className="mt-4"><BannersEditor /></TabsContent>}
        {canCms && <TabsContent value="series" className="mt-4"><SeriesEditor /></TabsContent>}
        {canCms && <TabsContent value="international" className="mt-4"><InternationalEvents /></TabsContent>}
        {canCms && <TabsContent value="schedules" className="mt-4"><MediaClubSchedules /></TabsContent>}
        <TabsContent value="photos" className="mt-4"><TournamentPhotosManager /></TabsContent>
        {canCms && <TabsContent value="support" className="mt-4"><AdminSupportTab /></TabsContent>}
      </Tabs>
    </div>
  );
};

export default MediaCenter;
