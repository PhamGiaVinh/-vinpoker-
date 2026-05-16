import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Shield, Newspaper, Image as ImageIcon, Trophy, CalendarDays, LifeBuoy, Globe } from "lucide-react";
import { Loader2 } from "lucide-react";
import { BannersEditor, SeriesEditor } from "./SuperAdmin";
import { AdminSupportTab } from "@/components/admin/AdminSupportTab";
import { MediaClubSchedules } from "@/components/admin/MediaClubSchedules";
import News from "./News";
import InternationalEvents from "./InternationalEvents";

const MediaCenter = () => {
  const { user, loading, isMediaOrAdmin } = useAuth();

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isMediaOrAdmin) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">Không có quyền</h2>
      <p className="text-sm text-muted-foreground">Cần vai trò Media hoặc Super Admin.</p>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-purple-400" />
        <div>
          <h1 className="font-display text-2xl text-purple-400">Media Center</h1>
          <p className="text-xs text-muted-foreground">Quản lý nội dung, banner, series, lịch CLB và hỗ trợ khách hàng.</p>
        </div>
      </div>

      <Tabs defaultValue="news">
        <div className="overflow-x-auto -mx-2 px-2 pb-1">
          <TabsList className="inline-flex w-max min-w-full">
            <TabsTrigger value="news" className="text-xs"><Newspaper className="w-3.5 h-3.5 mr-1" />Tin tức</TabsTrigger>
            <TabsTrigger value="banners" className="text-xs"><ImageIcon className="w-3.5 h-3.5 mr-1" />Banners</TabsTrigger>
            <TabsTrigger value="series" className="text-xs"><Trophy className="w-3.5 h-3.5 mr-1" />Series</TabsTrigger>
            <TabsTrigger value="international" className="text-xs"><Globe className="w-3.5 h-3.5 mr-1" />Quốc tế</TabsTrigger>
            <TabsTrigger value="schedules" className="text-xs"><CalendarDays className="w-3.5 h-3.5 mr-1" />Lịch CLB</TabsTrigger>
            <TabsTrigger value="support" className="text-xs"><LifeBuoy className="w-3.5 h-3.5 mr-1" />Hỗ trợ</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="news" className="mt-4"><News /></TabsContent>
        <TabsContent value="banners" className="mt-4"><BannersEditor /></TabsContent>
        <TabsContent value="series" className="mt-4"><SeriesEditor /></TabsContent>
        <TabsContent value="international" className="mt-4"><InternationalEvents /></TabsContent>
        <TabsContent value="schedules" className="mt-4"><MediaClubSchedules /></TabsContent>
        <TabsContent value="support" className="mt-4"><AdminSupportTab /></TabsContent>
      </Tabs>
    </div>
  );
};

export default MediaCenter;
