import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle } from "lucide-react";
import { PostComposer } from "./PostComposer";
import { PostList } from "./PostList";
import { ChannelSettings } from "./ChannelSettings";

// The marketing_* tables/RPCs ship source-only and are not yet in the generated Database types,
// so reads/writes go through this loosely-typed client (mirrors ChipOpsManager). Strictly additive.
const sb = supabase as any;

export interface ClubOption { id: string; name: string | null }

export const MarketingManager = () => {
  const { t } = useTranslation();
  const { isClubOwner, isAdmin } = useAuth();
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubId, setClubId] = useState<string>("");
  const [enabledChannels, setEnabledChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const canManageChannels = isClubOwner || isAdmin;

  // Load the clubs the current user may post for.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data, error } = await sb.rpc("marketing_my_clubs");
        if (!active) return;
        if (error) { setLoadError(true); setClubs([]); }
        else {
          const list = (data ?? []) as ClubOption[];
          setClubs(list);
          setClubId((prev) => prev || (list[0]?.id ?? ""));
        }
      } catch {
        if (active) { setLoadError(true); setClubs([]); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Load the enabled channels for the selected club.
  const loadChannels = useCallback(async (cid: string) => {
    if (!cid) { setEnabledChannels([]); return; }
    try {
      const { data, error } = await sb.rpc("marketing_list_enabled_channels", { p_club_id: cid });
      if (error || data?.error) { setEnabledChannels([]); return; }
      setEnabledChannels((data?.channels ?? []) as string[]);
    } catch {
      setEnabledChannels([]);
    }
  }, []);

  useEffect(() => { loadChannels(clubId); }, [clubId, loadChannels, refreshKey]);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const selectedClubName = useMemo(
    () => clubs.find((c) => c.id === clubId)?.name ?? "",
    [clubs, clubId],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {t("marketing.notReady")}
        </CardContent>
      </Card>
    );
  }

  if (clubs.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">{t("marketing.noClubs")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.club")}</Label>
        <Select value={clubId} onValueChange={setClubId}>
          <SelectTrigger><SelectValue placeholder={t("marketing.selectClub")} /></SelectTrigger>
          <SelectContent>
            {clubs.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="compose" className="w-full">
        <TabsList>
          <TabsTrigger value="compose">{t("marketing.tabs.compose")}</TabsTrigger>
          <TabsTrigger value="posts">{t("marketing.tabs.posts")}</TabsTrigger>
          {canManageChannels && <TabsTrigger value="channels">{t("marketing.tabs.channels")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="compose" className="mt-4">
          <PostComposer
            clubId={clubId}
            enabledChannels={enabledChannels}
            onPosted={bumpRefresh}
          />
        </TabsContent>

        <TabsContent value="posts" className="mt-4">
          <PostList clubId={clubId} refreshKey={refreshKey} onChanged={bumpRefresh} />
        </TabsContent>

        {canManageChannels && (
          <TabsContent value="channels" className="mt-4">
            <ChannelSettings clubId={clubId} clubName={selectedClubName} onChanged={bumpRefresh} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};
