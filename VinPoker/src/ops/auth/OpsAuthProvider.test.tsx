import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestSession = {
  user: { id: string };
  access_token: string;
};

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/opsClient", () => ({
  opsClient: { auth },
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  SupabaseClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { OpsAuthProvider, useOpsAuth } from "@/ops/auth/OpsAuthProvider";

const storedSession: TestSession = {
  user: { id: "10000000-0000-4000-8000-000000000001" },
  access_token: "cached-token",
};

function Probe() {
  const { loading, user } = useOpsAuth();
  return <p>{loading ? "loading" : (user?.id ?? "anonymous")}</p>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("OpsAuthProvider session acceptance", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not accept the browser INITIAL_SESSION before the Auth server confirms it", async () => {
    const verification = deferred<{ data: { user: { id: string } | null }; error: null }>();
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((listener) => {
      listener("INITIAL_SESSION", storedSession);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(<OpsAuthProvider><Probe /></OpsAuthProvider>);

    expect(screen.getByText("loading")).toBeInTheDocument();
    verification.resolve({ data: { user: storedSession.user }, error: null });

    await waitFor(() => {
      expect(screen.getByText(storedSession.user.id)).toBeInTheDocument();
    });
  });

  it("keeps a signed-out callback ahead of an in-flight validation", async () => {
    const verification = deferred<{ data: { user: { id: string } | null }; error: null }>();
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(<OpsAuthProvider><Probe /></OpsAuthProvider>);

    expect(listener).not.toBeNull();
    act(() => {
      listener?.("SIGNED_OUT", null);
    });
    verification.resolve({ data: { user: storedSession.user }, error: null });

    await waitFor(() => {
      expect(screen.getByText("anonymous")).toBeInTheDocument();
    });
  });
});
