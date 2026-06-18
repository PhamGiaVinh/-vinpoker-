import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableStateSummary } from "@/components/cashier/tournament-live/handinput/TableStateSummary";

describe("TableStateSummary (at-a-glance table state)", () => {
  it("shows street, pot, the acting seat and what they must call", () => {
    const html = renderToStaticMarkup(
      <TableStateSummary
        streetLabel="Flop"
        pot={12000}
        actorName="Bình"
        actorSeat={2}
        actorStack={18200}
        toCall={2400}
      />
    );
    expect(html).toContain("Flop");
    expect(html).toContain("Vòng");
    expect(html).toContain("Pot");
    expect(html).toContain("Ghế 2 · Bình");
  });

  it("shows a side-pot count when there is more than one pot", () => {
    const html = renderToStaticMarkup(
      <TableStateSummary streetLabel="River" pot={50000} sidePotCount={1} actorName="An" actorSeat={1} actorStack={0} toCall={0} />
    );
    expect(html).toContain("+1 side");
  });

  it("reports 'Vòng cược xong' and a dash when no one is left to act", () => {
    const html = renderToStaticMarkup(
      <TableStateSummary streetLabel="Turn" pot={8000} actorName={null} actorSeat={null} actorStack={null} toCall={0} />
    );
    expect(html).toContain("Vòng cược xong");
    expect(html).toContain("—");
  });
});
