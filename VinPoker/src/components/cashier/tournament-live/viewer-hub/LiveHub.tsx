// Public "Live Poker Event Hub" shell (Viewer Event Hub).
// Composes the hub header + stats bar around the spectator content. Presentational
// only; the caller supplies tournament meta and the live view (as `children`), so
// TournamentLiveView / LiveFelt / operator flow are untouched (zero felt-data
// fetching here — only the isolated useLiveTrackerData hook for the feeds/stats).
//
// `liveEventTabs` ON (RPT-Live style): a 5-tab event page (Cập nhật / Lịch sử ván /
// Giải thưởng / Cấu trúc / Hình ảnh). The felt mounts ON DEMAND — tap "Bàn đang
// chơi" to watch live, or a hand to replay. OFF: today's stacked layout (felt
// always shown), byte-identical.

import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Activity, History, Trophy, Layers3, Image as ImageIcon, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveHubHeader } from "./LiveHubHeader";
import { LiveStatsBar } from "./LiveStatsBar";
import { FeaturedTableCard } from "./FeaturedTableCard";
import { LiveTablesMap } from "./LiveTablesMap";
import { LiveStoryFeed } from "./LiveStoryFeed";
import { LiveUpdatesFeed } from "./LiveUpdatesFeed";
import { LiveHandFeed } from "./LiveHandFeed";
import { OrientationToggle } from "./OrientationToggle";
import { PrizesPanel } from "./PrizesPanel";
import { StructurePanel } from "./StructurePanel";
import { PhotosPanel } from "./PhotosPanel";
import { useLiveTrackerData } from "./useLiveTrackerData";
import { useIsMobile } from "@/hooks/use-mobile";
import { FEATURES } from "@/lib/featureFlags";

type Orientation = "landscape" | "portrait";
type Watch = { kind: "live"; tableId: string } | { kind: "replay"; handNumber: number } | null;
type ViewerProps = { orientationOverride?: Orientation; spectator?: boolean; selectedTableIdOverride?: string | null; initialReplayHandNumber?: number | null };

export interface LiveHubProps {
  tournamentId: string;
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  subtitle?: string | null;
  /** Tournament prize pool (VND) — from `tournaments.prize_pool`; null when unset. */
  prizePool?: number | null;
  /** Players still alive — from `tournaments.players_remaining`; null when unset. */
  playersRemaining?: number | null;
  /** Live level number — highlights the current row in the Cấu trúc tab. */
  currentLevel?: number | null;
  /** Event info chips for the header (GTD / buy-in / starting stack). */
  guarantee?: number | null;
  buyIn?: number | null;
  startingStack?: number | null;
  onShare: () => void;
  /** Deep-link (?hand=N) → open that hand in the featured viewer's replay. */
  initialReplayHandNumber?: number | null;
  /** Hand-feed "Xem ván" → open the hand in replay (sets ?hand=N at the page). */
  onViewHand?: (handNumber: number) => void;
  /** Hand-feed "Chia sẻ" → share a link to that specific hand. */
  onShareHand?: (handNumber: number) => void;
  /** Clear the ?hand param when leaving the felt (back to the tabs). */
  onCloseHand?: () => void;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
}

export function LiveHub({
  tournamentId, title, clubName, clubId, subtitle, prizePool, playersRemaining, currentLevel,
  guarantee, buyIn, startingStack,
  onShare, initialReplayHandNumber = null, onViewHand, onShareHand, onCloseHand, children,
}: LiveHubProps) {
  // Isolated hub data (count / all-tables / feed / chip leader). Does NOT touch
  // TournamentLiveView — the featured felt still renders the real viewer when watched.
  const { liveTableCount, tables, feed, chipLeader, storyFeed, activeHandTableId } = useLiveTrackerData(tournamentId);
  const { t } = useTranslation();

  // "Cập nhật … trước" — stamp the moment the hub data last changed (each poll for a
  // live event re-stamps, so the header stays fresh; a finished event freezes).
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => { setLastUpdated(new Date()); }, [feed, tables, storyFeed]);

  // Public table-map picker (legacy stacked layout): which table to feature.
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const featuredTableId = selectedTableId ?? activeHandTableId;

  // Orientation: default to the device, but let the viewer flip Ngang/Dọc.
  const isMobile = useIsMobile();
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const effectiveOrientation: Orientation = orientation ?? (isMobile ? "portrait" : "landscape");

  // Event-tabs: which felt (if any) the viewer is actively watching. null → tabs.
  // Seeded synchronously from a deep-linked hand (?hand=N) so it opens its replay
  // on first paint; the effect re-syncs if the deep-link changes while mounted.
  const [watch, setWatch] = useState<Watch>(initialReplayHandNumber != null ? { kind: "replay", handNumber: initialReplayHandNumber } : null);
  useEffect(() => {
    if (initialReplayHandNumber != null) setWatch({ kind: "replay", handNumber: initialReplayHandNumber });
  }, [initialReplayHandNumber]);

  const closeWatch = () => {
    setWatch(null);
    onCloseHand?.();
  };

  // Clone the child viewer with presentational overrides (orientation + spectator,
  // plus the table/hand to show). Guard: only inject into component children.
  const cloneViewer = (extra: ViewerProps): ReactNode =>
    isValidElement(children) && typeof children.type !== "string"
      ? cloneElement(children as ReactElement<ViewerProps>, { orientationOverride: effectiveOrientation, spectator: true, ...extra })
      : children;

  // ── Legacy stacked layout (flag OFF) — byte-identical to before ────────────────
  if (!FEATURES.liveEventTabs) {
    const viewer = cloneViewer({ selectedTableIdOverride: selectedTableId, initialReplayHandNumber });
    return (
      <div className="space-y-3 sm:space-y-4 animate-in fade-in-0 duration-500 motion-reduce:animate-none">
        <LiveHubHeader title={title} clubName={clubName} clubId={clubId} subtitle={subtitle} liveTableCount={liveTableCount} guarantee={guarantee} buyIn={buyIn} startingStack={startingStack} lastUpdated={lastUpdated} onShare={onShare} />
        <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={chipLeader} />
        <LiveTablesMap tables={tables} activeTableId={featuredTableId} onSelect={setSelectedTableId} />
        <FeaturedTableCard
          badge={t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
          headerAction={<OrientationToggle value={effectiveOrientation} onChange={setOrientation} />}
        >
          {viewer}
        </FeaturedTableCard>
        {FEATURES.liveHandFeed ? (
          <>
            <LiveUpdatesFeed feed={feed} />
            <LiveHandFeed tournamentId={tournamentId} featuredTableId={featuredTableId} onViewHand={onViewHand} onShare={onShareHand} />
          </>
        ) : (
          <>
            <LiveStoryFeed items={storyFeed} />
            <LiveUpdatesFeed feed={feed} />
          </>
        )}
      </div>
    );
  }

  // ── Event-tabs layout (flag ON) ────────────────────────────────────────────────
  // Hand-feed "Xem ván" → open the replay felt AND keep ?hand=N in the URL (share).
  const handleViewHand = (n: number) => {
    setWatch({ kind: "replay", handNumber: n });
    onViewHand?.(n);
  };

  const watchViewer = watch
    ? cloneViewer(
        watch.kind === "replay"
          ? { initialReplayHandNumber: watch.handNumber, selectedTableIdOverride: null }
          : { initialReplayHandNumber: null, selectedTableIdOverride: watch.tableId },
      )
    : null;

  const TAB_TRIGGER =
    "relative rounded-none border-b-2 border-transparent bg-transparent px-2.5 py-2 text-[12px] font-semibold text-muted-foreground shadow-none data-[state=active]:border-[hsl(var(--poker-gold))] data-[state=active]:bg-transparent data-[state=active]:text-[hsl(var(--poker-gold))] data-[state=active]:shadow-none sm:px-3.5 sm:text-sm";

  return (
    <div className="space-y-3 sm:space-y-4 animate-in fade-in-0 duration-500 motion-reduce:animate-none">
      <LiveHubHeader title={title} clubName={clubName} clubId={clubId} subtitle={subtitle} liveTableCount={liveTableCount} onShare={onShare} />
      <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={chipLeader} />

      {watch ? (
        <div className="space-y-2 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          <button
            type="button"
            onClick={closeWatch}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-emerald-500/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("liveHub.tabs.back", "Quay lại")}
          </button>
          <FeaturedTableCard
            badge={watch.kind === "replay" ? t("liveHub.watch.replay", "PHÁT LẠI VÁN") : t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
            headerAction={<OrientationToggle value={effectiveOrientation} onChange={setOrientation} />}
          >
            {watchViewer}
          </FeaturedTableCard>
        </div>
      ) : (
        <Tabs defaultValue="updates" className="w-full">
          <div className="-mx-2 overflow-x-auto px-2 pb-px">
            <TabsList className="inline-flex h-auto w-max min-w-full justify-start gap-0.5 border-b border-border/40 bg-transparent p-0">
              <TabsTrigger value="updates" className={TAB_TRIGGER}><Activity className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.updates", "Cập nhật")}</TabsTrigger>
              <TabsTrigger value="history" className={TAB_TRIGGER}><History className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.handHistory", "Lịch sử ván")}</TabsTrigger>
              <TabsTrigger value="prizes" className={TAB_TRIGGER}><Trophy className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.prizes", "Giải thưởng")}</TabsTrigger>
              <TabsTrigger value="structure" className={TAB_TRIGGER}><Layers3 className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.structure", "Cấu trúc")}</TabsTrigger>
              <TabsTrigger value="photos" className={TAB_TRIGGER}><ImageIcon className="mr-1 h-3.5 w-3.5" />{t("liveHub.tabs.photos", "Hình ảnh")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="updates" className="mt-3 space-y-3 sm:space-y-4">
            <LiveTablesMap
              tables={tables}
              activeTableId={null}
              onSelect={(id) => setWatch({ kind: "live", tableId: id })}
              minToShow={1}
              title={t("liveHub.watch.title", "Bàn đang chơi")}
            />
            <LiveStoryFeed items={storyFeed} />
            <LiveUpdatesFeed feed={feed} />
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <LiveHandFeed tournamentId={tournamentId} featuredTableId={activeHandTableId} onViewHand={handleViewHand} onShare={onShareHand} />
          </TabsContent>

          <TabsContent value="prizes" className="mt-3">
            <PrizesPanel tournamentId={tournamentId} />
          </TabsContent>

          <TabsContent value="structure" className="mt-3">
            <StructurePanel tournamentId={tournamentId} currentLevel={currentLevel} />
          </TabsContent>

          <TabsContent value="photos" className="mt-3">
            <PhotosPanel tournamentId={tournamentId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
