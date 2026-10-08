import { describe, expect, it } from "vitest";
import { chipOpsRpcErrorMessage } from "./chipOpsErrors";
describe("chip operation transport errors", () => {
  it("does not call a fetch failure an unavailable feature", () => {
    expect(chipOpsRpcErrorMessage(new TypeError("Failed to fetch"))).toContain("Không kết nối");
    expect(chipOpsRpcErrorMessage({ status: 503 })).not.toContain("chưa sẵn sàng");
  });
  it("distinguishes missing RPC and denied access", () => {
    expect(chipOpsRpcErrorMessage({ code: "PGRST202" })).toContain("chưa sẵn sàng");
    expect(chipOpsRpcErrorMessage({ code: "42501" })).toContain("quyền");
  });
});
