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

// C2 (trackerStreetRollback) — the OPTIONAL "Hoàn tác cả vòng" button.
describe("HandControlsStrip street rollback (C2)", () => {
  it("prop absent === prop null === byte-identical to today (no rollback button)", () => {
    const absent = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={true} hasVoidTarget={false} />
    );
    const asNull = renderToStaticMarkup(
      <HandControlsStrip {...base} canUndo={true} hasVoidTarget={false} streetRollback={null} />
    );
    expect(asNull).toBe(absent);
    expect(absent).not.toContain("Hoàn tác cả vòng");
  });

  it("idle: renders the labeled amber button, enabled", () => {
    const html = renderToStaticMarkup(
      <HandControlsStrip
        {...base}
        canUndo={true}
        hasVoidTarget={false}
        streetRollback={{ label: "Flop", busy: false }}
        onStreetRollback={noop}
      />
    );
    expect(html).toContain("Hoàn tác cả vòng Flop");
    expect(html).toContain('aria-label="Hoàn tác cả vòng Flop"');
  });

  it("busy: shows k/N progress and is disabled", () => {
    const html = renderToStaticMarkup(
      <HandControlsStrip
        {...base}
        canUndo={true}
        hasVoidTarget={false}
        streetRollback={{ label: "Turn", busy: true, progress: "2/3" }}
        onStreetRollback={noop}
      />
    );
    expect(html).toContain("Đang hoàn tác… (2/3)");
    expect(html).toContain('disabled=""');
  });

  it("disabledReason: disabled with the reason as title + aria-label", () => {
    const reason =
      "Không thể hoàn tác cả vòng sau khi tải lại ván. Hãy hoàn tác từng hành động hoặc void hand.";
    const html = renderToStaticMarkup(
      <HandControlsStrip
        {...base}
        canUndo={true}
        hasVoidTarget={false}
        streetRollback={{ label: "River", busy: false, disabledReason: reason }}
        onStreetRollback={noop}
      />
    );
    expect(html).toContain(`title="${reason}"`);
    expect(html).toContain(`aria-label="${reason}"`);
    expect(html).toContain('disabled=""');
    expect(html).toContain("Hoàn tác cả vòng River");
  });
});
