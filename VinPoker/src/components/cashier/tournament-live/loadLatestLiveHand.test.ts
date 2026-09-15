import { describe, expect, it, vi } from "vitest";
const { rows } = vi.hoisted(() => ({ rows: [
  { id: "new-b5", tournament_id: "tour", table_id: "b5", is_voided: false },
  { id: "void-b2", tournament_id: "tour", table_id: "b2", is_voided: true },
  { id: "foreign-b2", tournament_id: "other", table_id: "b2", is_voided: false },
  { id: "old-b2", tournament_id: "tour", table_id: "b2", is_voided: false },
] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  let selected = [...rows];
  const query = {
    select: () => query,
    eq: (key: keyof typeof rows[number], value: unknown) => {
      selected = selected.filter(row => row[key] === value); return query;
    },
    order: () => query,
    limit: (count: number) => Promise.resolve({ data: selected.slice(0, count), error: null }),
  };
  return query;
} } }));
import { loadLatestLiveHand } from "./loadLatestLiveHand";

describe("live hand table scope", () => {
  it("selects table 2's hand even when table 5 has the newest tournament hand", async () => {
    expect((await loadLatestLiveHand("tour", "b2")).data?.map(row => row.id)).toEqual(["old-b2"]);
  });
  it("keeps a table without hands empty instead of falling back across tables", async () => {
    expect((await loadLatestLiveHand("tour", "empty")).data).toEqual([]);
  });
  it("keeps the unscoped latest-hand behavior for existing callers", async () => {
    expect((await loadLatestLiveHand("tour", null)).data?.map(row => row.id)).toEqual(["new-b5"]);
  });
});
