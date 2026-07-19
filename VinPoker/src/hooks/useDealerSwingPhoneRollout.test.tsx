// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { useDealerSwingPhoneRollout } from "@/hooks/useDealerSwingPhoneRollout";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.clearAllMocks());

describe("useDealerSwingPhoneRollout", () => {
  it("drops an old club response after the selected club changes", async () => {
    const oldClub = deferred<{ data: unknown; error: null }>();
    const newClub = deferred<{ data: unknown; error: null }>();
    const rpc = vi.mocked(supabase.rpc as unknown as (
      name: string,
      args: { p_expected_club_id: string },
    ) => { abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: null }> });

    rpc.mockImplementation((_name, args) => ({
      abortSignal: () => args.p_expected_club_id === "club-a" ? oldClub.promise : newClub.promise,
    }));

    const { result, rerender, unmount } = renderHook(
      ({ clubId }) => useDealerSwingPhoneRollout(clubId),
      { initialProps: { clubId: "club-a" } },
    );
    rerender({ clubId: "club-b" });

    await act(async () => {
      newClub.resolve({
        data: { master_enabled: true, allowlisted: true, all_clubs_enabled: false },
        error: null,
      });
      await newClub.promise;
    });
    await waitFor(() => expect(result.current.allowed).toBe(true));

    await act(async () => {
      oldClub.resolve({
        data: { master_enabled: false, allowlisted: false, all_clubs_enabled: false },
        error: null,
      });
      await oldClub.promise;
    });
    expect(result.current.allowed).toBe(true);
    unmount();
  });

  it("fails closed when the rollout query errors", async () => {
    const rpc = vi.mocked(supabase.rpc as unknown as () => {
      abortSignal: (signal: AbortSignal) => Promise<{ data: null; error: { message: string } }>;
    });
    rpc.mockReturnValue({
      abortSignal: async () => ({ data: null, error: { message: "network unavailable" } }),
    });

    const { result, unmount } = renderHook(() => useDealerSwingPhoneRollout("club-a"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.error).toBe("network unavailable");
    unmount();
  });
});
