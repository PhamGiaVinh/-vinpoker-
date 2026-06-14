import { describe, expect, it } from "vitest";
import { buildScheduleSvg } from "../shiftPlanner/scheduleImage";

describe("buildScheduleSvg", () => {
  it("renders a valid SVG with dealer names, XML-escaped, and empty-group marker", () => {
    const { svg, width, height } = buildScheduleSvg({
      title: "Lịch dealer · T4 17/06",
      subtitle: "2 ca",
      groups: [
        {
          label: "08–16",
          window: "08:00 – 16:00",
          need: 2,
          rows: [
            { name: "A & B <x>", role: "Dealer", skills: ["Cash"] },
            { name: "Đỗ Quốc Anh", role: "Lead", skills: ["Tournament", "Cash"] },
          ],
        },
        { label: "16–00", window: "16:00 – 00:00", need: 1, rows: [] },
      ],
    });

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("Lịch dealer · T4 17/06");
    expect(svg).toContain("Đỗ Quốc Anh");
    expect(svg).toContain("A &amp; B &lt;x&gt;"); // XML-escaped, no raw &/</>
    expect(svg).not.toContain("A & B <x>");
    expect(svg).toContain("— chưa có dealer —"); // empty group placeholder
    expect(width).toBe(760);
    expect(height).toBeGreaterThan(120);
  });
});
