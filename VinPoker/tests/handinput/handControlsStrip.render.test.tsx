import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HandControlsStrip } from "@/components/cashier/tournament-live/handinput/HandControlsStrip";

const noop = () => {};
const base = { onUndo: noop, onReset: noop, onVoid: noop };

describe("HandControlsStrip (persistent Undo / Reset / Void)", () => {
  it("always renders Hoàn tác and Reset", () => {
    const html = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={true} hasVoidTarget={false} />
    );
    expect(html).toContain("Hoàn tác");
    expect(html).toContain("Reset");
  });

  it("disables Hoàn tác when there is nothing to undo", () => {
    const html = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={false} hasVoidTarget={false} />
    );
    expect(html).toContain('disabled=""');
  });

  it("shows Void only when there is a void target", () => {
    const without = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={true} hasVoidTarget={false} />
    );
    expect(without).not.toContain("Void");

    const withTarget = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={true} hasVoidTarget={true} />
    );
    expect(withTarget).toContain("Void");
  });
});
