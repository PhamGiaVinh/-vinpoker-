import type { ViewerTab } from "./viewerTypes";

const VIEWER_TABS = new Set<ViewerTab>(["updates", "hands", "prizes", "structure", "photos"]);

export function parseViewerTab(value: string | null, fallback: ViewerTab = "updates"): ViewerTab {
  return value && VIEWER_TABS.has(value as ViewerTab) ? (value as ViewerTab) : fallback;
}

export function viewerTabToPanel(tab: ViewerTab): string {
  return tab === "hands" ? "history" : tab;
}

export function panelToViewerTab(panel: string): ViewerTab {
  return panel === "history" ? "hands" : parseViewerTab(panel);
}
