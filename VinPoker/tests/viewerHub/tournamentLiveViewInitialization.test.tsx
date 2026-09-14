import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isStaffOps: false, isClubAdmin: false }) }));
vi.mock("@/components/td-ai/TdAiAssistantPanel", () => ({ TdAiAssistantPanel: () => null }));

import { TournamentLiveView } from "@/components/cashier/tournament-live/TournamentLiveView";

describe("TournamentLiveView initial render", () => {
  it.each([false, true])("initializes every hook before the loading screen (spectator=%s)", spectator => {
    // Render the real parent, not just LiveFelt/ReplayScrubber. Effects do not run
    // on the server, so this catches initialization errors without network IO.
    expect(() => renderToString(<TournamentLiveView tournamentId="test-tournament" spectator={spectator}
      initialReplayTarget={{ handId: "test-hand", tableId: "test-table", handNumber: 2 }} />)).not.toThrow();
  });
});
