import { describe, expect, it } from "vitest";
import { buildWeeklyScheduleSvg, type WeeklyImageInput } from "@/lib/shiftPlanner/weeklyImage";

const INPUT: WeeklyImageInput = {
  title: "Lịch dealer · Tuần 29/06 – 05/07",
  subtitle: "68 ca · 544 giờ",
  days: ["T2 29/06", "T3 30/06", "T4 01/07", "T5 02/07", "T6 03/07", "T7 04/07", "CN 05/07"],
  rows: [
    {
      label: "08–16",
      window: "08:00 – 16:00",
      cells: [
        { names: ["pgv", "dl 8"] },
        { names: ["dl 7"] },
        { names: [] },
        { names: ["25 <&>"] },
        { names: [] },
        { names: [] },
        { names: [] },
      ],
    },
    {
      label: "16–00",
      window: "16:00 – 00:00",
      cells: [{ names: [] }, { names: [] }, { names: [] }, { names: ["dl 3"] }, { names: [] }, { names: [] }, { names: [] }],
    },
  ],
};

describe("buildWeeklyScheduleSvg (xuất ảnh tuần)", () => {
  it("renders a valid SVG with title, all day headers, dealer names, and per-day totals", () => {
    const { svg, width, height } = buildWeeklyScheduleSvg(INPUT);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg).toContain("Lịch dealer · Tuần 29/06 – 05/07");
    for (const d of INPUT.days) expect(svg).toContain(d);
    expect(svg).toContain("pgv");
    expect(svg).toContain("dl 3");
    // Totals row: T2 has 2 shifts, T5 has 2 (one per row).
    expect(svg).toContain(">2 ca<");
    expect(svg).toContain("Tổng");
  });

  it("escapes XML-hostile characters in names", () => {
    const { svg } = buildWeeklyScheduleSvg(INPUT);
    expect(svg).toContain("25 &lt;&amp;&gt;");
    expect(svg).not.toContain("25 <&>");
  });

  it("empty cells render a dash placeholder instead of collapsing", () => {
    const { svg } = buildWeeklyScheduleSvg(INPUT);
    expect(svg).toContain("—");
  });
});
