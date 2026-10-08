import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: unknown[]; error: null };
type QueryBuilder = {
  select: () => QueryBuilder;
  update: () => QueryBuilder;
  eq: () => QueryBuilder;
  limit: () => QueryBuilder;
  is: () => QueryBuilder;
  then: <TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

const auth = vi.hoisted(() => ({
  listener: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  getSession: vi.fn(),
  queryReads: [] as Array<{ table: string; userId: string }>,
  resolveQuery: null as ((table: string, userId: string) => Promise<QueryResponse>) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: (table: string) => {
      let userId = "";
      const query = {} as QueryBuilder;
      query.select = () => query;
      query.update = () => query;
      query.eq = (_column?: string, value?: string) => {
        if (value) userId = value;
        return query;
      };
      query.limit = () => query;
      query.is = () => query;
      query.then = (onfulfilled, onrejected) => {
        if (table !== "profiles") auth.queryReads.push({ table, userId });
        const result = auth.resolveQuery
          ? auth.resolveQuery(table, userId)
          : Promise.resolve({
            data: table === "user_roles" ? [{ role: "cashier" }] : [{ id: "row" }],
            error: null,
          });
        return result.then(onfulfilled, onrejected);
      };
      return { select: () => query, update: () => query };
    },
  },
}));

vi.mock("@/lib/onesignal", () => ({ linkUser: vi.fn(), logoutUser: vi.fn() }));
vi.mock("@/lib/chipMaster", () => ({ deriveIsChipMaster: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/marketer", () => ({ deriveIsMarketing: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/fnbStaff", () => ({ deriveIsFnb: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/accountant", () => ({ deriveIsAccountant: vi.fn().mockResolvedValue(false) }));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

function Probe() {
  const { user, loading, rolesLoading, rolesError, isCashier, isAdmin } = useAuth();
  const authState = loading ? "auth-loading" : user?.id ?? "anonymous";
  const roleState = rolesLoading ? "roles-loading" : rolesError ?? (isAdmin ? "admin" : isCashier ? "cashier" : "no-role");
  return <p>{`${authState}|${roleState}`}</p>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function renderAuth() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

describe("AuthProvider role loading", () => {
  beforeEach(() => {
    auth.listener = null;
    auth.queryReads = [];
    auth.resolveQuery = null;
    auth.getSession.mockReset();
  });

  it("loads base roles only once when the initial auth event and getSession return the same user", async () => {
    const session = { user: { id: "owner-a" } };
    auth.getSession.mockResolvedValue({ data: { session }, error: null });

    renderAuth();
    expect(await screen.findByText("owner-a|cashier")).toBeInTheDocument();

    act(() => { auth.listener?.("INITIAL_SESSION", session); });

    await waitFor(() => {
      expect(auth.queryReads.filter((query) => query.table === "user_roles" && query.userId === "owner-a")).toHaveLength(1);
    });
  });

  it("ignores an older account's role response after sign-out", async () => {
    const oldRoleRead = deferred<QueryResponse>();
    auth.resolveQuery = (table, userId) => table === "user_roles" && userId === "owner-old"
      ? oldRoleRead.promise
      : Promise.resolve({ data: [], error: null });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    renderAuth();
    await waitFor(() => expect(screen.getByText("anonymous|no-role")).toBeInTheDocument());
    act(() => { auth.listener?.("SIGNED_IN", { user: { id: "owner-old" } }); });
    await waitFor(() => expect(screen.getByText("owner-old|roles-loading")).toBeInTheDocument());
    act(() => { auth.listener?.("SIGNED_OUT", null); });
    oldRoleRead.resolve({ data: [{ role: "super_admin" }], error: null });

    await waitFor(() => expect(screen.getByText("anonymous|no-role")).toBeInTheDocument());
  });
});
