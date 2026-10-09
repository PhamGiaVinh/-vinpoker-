import { describe, expect, it, vi } from "vitest";
import { archiveBankrollEntries, restoreBankrollEntry } from "./bankrollArchiveApi";
describe("optional bankroll archive contract", () => {
  it("does not report an absent backend as a successful deletion", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "RPC not found" } });
    await expect(archiveBankrollEntries(rpc, "entry-a")).rejects.toThrow("RPC not found");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("requires the exact single-entry count and a boolean restore result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
    await expect(archiveBankrollEntries(rpc, "entry-a")).rejects.toThrow("Không xác nhận");
    rpc.mockResolvedValue({ data: "true", error: null });
    await expect(restoreBankrollEntry(rpc, "entry-a")).rejects.toThrow("Không xác nhận");
  });
  it("preserves explicit successful and expired outcomes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    expect(await archiveBankrollEntries(rpc, "entry-a")).toBe(1);
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await restoreBankrollEntry(rpc, "entry-a")).toBe(false);
  });
});
