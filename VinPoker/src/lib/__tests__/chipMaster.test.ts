import { describe, it, expect, vi } from "vitest";
import { deriveIsChipMaster } from "../chipMaster";

// Minimal supabase-query-builder double: from(...).select(...).eq(...).limit(...) -> Promise.
function mockClient(result: any, throws = false) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => (throws ? Promise.reject(new Error("boom")) : Promise.resolve(result))),
  };
  const from = vi.fn(() => builder);
  return { from };
}

describe("deriveIsChipMaster — P0-1 guard (useAuth runs globally; table is source-only)", () => {
  it("flag OFF: never queries the table, returns false", async () => {
    const { from } = mockClient({ data: [{ club_id: "c1" }], error: null });
    const r = await deriveIsChipMaster("u1", { client: { from }, enabled: false });
    expect(r).toBe(false);
    expect(from).not.toHaveBeenCalled(); // proves no club_chip_masters query in prod (flag off)
  });

  it("no userId: never queries, returns false", async () => {
    const { from } = mockClient({ data: [], error: null });
    const r = await deriveIsChipMaster(null, { client: { from }, enabled: true });
    expect(r).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("flag ON + table absent (42P01 error result): caught, returns false (auth unaffected)", async () => {
    const { from } = mockClient({ data: null, error: { code: "42P01", message: "relation \"club_chip_masters\" does not exist" } });
    const r = await deriveIsChipMaster("u1", { client: { from }, enabled: true });
    expect(r).toBe(false);
    expect(from).toHaveBeenCalledWith("club_chip_masters");
  });

  it("flag ON + query throws: caught, returns false", async () => {
    const { from } = mockClient(null, true);
    const r = await deriveIsChipMaster("u1", { client: { from }, enabled: true });
    expect(r).toBe(false);
  });

  it("flag ON + membership row present: returns true", async () => {
    const { from } = mockClient({ data: [{ club_id: "c1" }], error: null });
    const r = await deriveIsChipMaster("u1", { client: { from }, enabled: true });
    expect(r).toBe(true);
  });

  it("flag ON + no rows: returns false", async () => {
    const { from } = mockClient({ data: [], error: null });
    const r = await deriveIsChipMaster("u1", { client: { from }, enabled: true });
    expect(r).toBe(false);
  });
});
