import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewerTab } from "./viewerTypes";
const { hubData, publicData } = vi.hoisted(() => ({
  hubData: { tables: [], feed: [], storyFeed: [] },
  publicData: { snapshot: { access: "public", sections: { tables: { catalog: [{ tableId: "table-2", name: "Bàn 2", playerCount: 3, searchPlayers: [] }], items: [] } } } },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { publicSpectatorRealtimeV2: true, liveEventTabs: true, liveViewerRPTShell: true, liveHandFeed: true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./useLiveTrackerData", () => ({ useLiveTrackerData: () => hubData }));
vi.mock("./usePublicSpectatorSnapshot", () => ({ usePublicSpectatorSnapshot: () => publicData }));
vi.mock("./LiveHubHeader", () => ({ LiveHubHeader: () => null }));
vi.mock("./LiveStatsBar", () => ({ LiveStatsBar: () => null }));
vi.mock("./LiveStoryFeed", () => ({ LiveStoryFeed: () => null }));
vi.mock("./LiveUpdatesFeed", () => ({ LiveUpdatesFeed: () => null }));
vi.mock("./LiveHandFeed", () => ({ LiveHandFeed: ({ featuredTableId, initialTableHistory, variant }: { featuredTableId: string; initialTableHistory: boolean; variant: string }) => <output data-testid="feed">{variant}:{featuredTableId}:{String(initialTableHistory)}</output> }));
import { LiveHub } from "./LiveHub";

describe("table history lives in Updates", () => {
  it("keeps four sections and opens Updates with the selected table history", () => {
    function App() {
      const [activeTab, onTabChange] = useState<ViewerTab>("hands");
      return <LiveHub tournamentId="tour" title="TEST" onShare={() => {}} activeTab={activeTab} onTabChange={onTabChange}><div /></LiveHub>;
    }
    render(<App />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Bàn LIVE" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(screen.getByRole("article", { name: "Bàn 2" })).getByRole("button", { name: "Lịch sử" }));
    expect(screen.getByRole("tab", { name: "Cập nhật" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("feed")).toHaveTextContent("updates:table-2:true");
  });
});
