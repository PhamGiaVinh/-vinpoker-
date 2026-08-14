import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { attachLivestreamMetadata, type PublicStreamRow } from "@/lib/livestreamCatalog";

const sectionSource = readFileSync(resolve(process.cwd(), "src/components/LivestreamSection.tsx"), "utf8");

const stream = (overrides: Partial<PublicStreamRow> = {}): PublicStreamRow => ({
  id: "stream-1",
  platform: "youtube",
  stream_url: "https://www.youtube.com/live/example",
  title: "External final table",
  match_title: null,
  scheduled_at: null,
  thumbnail_url: null,
  custom_tournament_name: null,
  is_live: true,
  tournament_id: null,
  ...overrides,
});

describe("public livestream catalog", () => {
  it("keeps a custom live stream visible without tournament metadata", () => {
    const [item] = attachLivestreamMetadata([stream()], [], []);

    expect(item.is_live).toBe(true);
    expect(item.tournament).toBeNull();
    expect(item.title).toBe("External final table");
  });

  it("attaches tournament and club labels without an embedded PostgREST join", () => {
    const [item] = attachLivestreamMetadata(
      [stream({ tournament_id: "tournament-1" })],
      [{ id: "tournament-1", name: "Main Event", start_time: "2026-08-14T10:00:00Z", club_id: "club-1" }],
      [{ id: "club-1", name: "Onyx" }],
    );

    expect(item.tournament).toEqual({
      id: "tournament-1",
      name: "Main Event",
      start_time: "2026-08-14T10:00:00Z",
      club: { name: "Onyx" },
    });
  });

  it("does not use the missing tournament_streams embedded relationship and exposes a retryable read error", () => {
    expect(sectionSource).not.toContain("tournament:tournaments(");
    expect(sectionSource).toContain("is_live,tournament_id");
    expect(sectionSource).toContain('.from("tournaments")');
    expect(sectionSource).toContain('.from("clubs")');
    expect(sectionSource).toContain("setLoadError");
  });
});
