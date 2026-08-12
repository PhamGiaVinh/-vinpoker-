// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import type { Tournament } from "@/types/tournament";

const pendingResponse = new Promise<never>(() => {});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => pendingResponse),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => pendingResponse),
      })),
    })),
    functions: {
      invoke: vi.fn(() => pendingResponse),
    },
  },
}));

import { FloorTableMapPanel } from "../FloorTableMapPanel";
import { supabase } from "@/integrations/supabase/client";

afterEach(cleanup);

describe("FloorTableMapPanel loading state", () => {
  it("renders the table-map skeleton while the tournament tables are loading", () => {
    const { container } = render(
      <SupabaseClientProvider client={supabase as never}>
        <FloorTableMapPanel
          tournament={{
            id: "tournament-1",
            club_id: "club-1",
            name: "Giải TEST",
            status: "running",
          } as Tournament}
          refreshTrigger={0}
        />
      </SupabaseClientProvider>,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(18);
  });
});
