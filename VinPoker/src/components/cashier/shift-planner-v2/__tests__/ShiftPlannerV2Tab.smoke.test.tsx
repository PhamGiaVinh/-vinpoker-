import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The supabase client reads VITE_* env vars at import time (undefined in tests).
// Mock mode never calls it for planner data; the run-status/tournaments/link
// hooks are disabled in mock mode. Mirrors ShiftPlannerTab.smoke.test.tsx.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import ShiftPlannerV2Tab from "../ShiftPlannerV2Tab";

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("ShiftPlannerV2Tab (smoke, mock mode)", () => {
  it("renders the 4-step flow header + week strip and walks Tạo lịch → Rà soát", async () => {
    render(<ShiftPlannerV2Tab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} />);

    // Header + the 4 step chips
    expect(await screen.findByText("Xếp lịch dealer")).toBeInTheDocument();
    expect(await screen.findByText("Tạo lịch")).toBeInTheDocument();
    expect(await screen.findByText("Thêm thủ công")).toBeInTheDocument();
    expect(await screen.findByText("Rà soát")).toBeInTheDocument();
    expect(await screen.findByText("Phát hành & báo")).toBeInTheDocument();

    // Mock data auto-fills a draft → step 1 shows the "Đã có nháp" state + CTA
    expect((await screen.findAllByText(/Tạo nháp AI|Tạo lại nháp AI/)).length).toBeGreaterThan(0);

    // Step 1 shows the inline per-shift demand steppers (matches mockup B1)
    expect(await screen.findByText("Số người cần cho mỗi ca")).toBeInTheDocument();

    // Week strip renders 7 day chips with tour counts (mock demo values)
    expect((await screen.findAllByText(/tour ·/)).length).toBeGreaterThan(0);

    // Requests bell toggles the actionable panel (mock scenario has requests)
    fireEvent.click(screen.getByText("Yêu cầu"));
    expect(await screen.findByText(/Yêu cầu từ Dealer App/)).toBeInTheDocument();
  });

  it("step 3 shows plain-VN review content from the mock draft", async () => {
    render(<ShiftPlannerV2Tab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} />);

    fireEvent.click(await screen.findByText("Rà soát"));
    // Summary cards + coverage + grouped table all mount
    expect(await screen.findByText("Tổng nhu cầu")).toBeInTheDocument();
    expect(await screen.findByText("Coverage theo giờ")).toBeInTheDocument();
    expect((await screen.findAllByText("Thêm dealer")).length).toBeGreaterThan(0);
  });

  it("demand dialog renders the chia-final designation checkbox (Patch 2)", async () => {
    render(<ShiftPlannerV2Tab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} />);

    fireEvent.click(await screen.findByText("📌 Chỉ định dealer chia final / sửa chi tiết"));
    expect(await screen.findByText("Nhu cầu dealer hôm nay")).toBeInTheDocument();
    // One "Có bàn final / bàn tâm điểm" checkbox per template row
    expect((await screen.findAllByText("Có bàn final / bàn tâm điểm")).length).toBeGreaterThan(0);
  });

  it('shows the "Tự động xếp" button only when autofillEnabled (Patch 3)', async () => {
    const { unmount } = render(
      <ShiftPlannerV2Tab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} />
    );
    // Default (flag off, no preview) → no autofill button
    expect(screen.queryByText("Tự động xếp")).toBeNull();
    unmount();

    render(
      <ShiftPlannerV2Tab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} autofillEnabled />
    );
    expect(await screen.findByText("Tự động xếp")).toBeInTheDocument();
  });
});
