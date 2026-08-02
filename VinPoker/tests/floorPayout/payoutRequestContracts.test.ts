import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270107000000_floor_payout_requests.sql"),
  "utf8",
);
const disposableSql = readFileSync(
  resolve(root, "tests/floorPayout/disposableDb.integration.sql"),
  "utf8",
);
const flags = readFileSync(resolve(root, "src/lib/featureFlags.ts"), "utf8");
const opsApp = readFileSync(resolve(root, "src/OpsApp.tsx"), "utf8");
const payoutWorkspace = readFileSync(resolve(root, "src/ops/floor/PayoutWorkspace.tsx"), "utf8");
const opsCashier = readFileSync(resolve(root, "src/pages/ops/OpsCashier.tsx"), "utf8");
const floorRequestPanel = readFileSync(
  resolve(root, "src/ops/payout/FloorPayoutRequestPanel.tsx"),
  "utf8",
);
const reviewQueue = readFileSync(
  resolve(root, "src/ops/payout/PayoutRequestQueuePage.tsx"),
  "utf8",
);
const permissionsPage = readFileSync(
  resolve(root, "src/ops/payout/PayoutPermissionsPage.tsx"),
  "utf8",
);
describe("dual-control payout source contract", () => {
  it("ships dark and uses one master UI flag", () => {
    expect(flags).toMatch(/floorPayoutRequestFlow:\s*false/);
    expect(payoutWorkspace).toContain("FEATURES.floorPayoutRequestFlow");
    expect(opsApp).toContain("/ops/cashier/payout-requests");
    expect(opsApp).toContain("/ops/cashier/payout-permissions");
    expect(opsCashier).toContain("sẽ ghi ledger thật");
  });

  it("keeps amount and recipient server-derived", () => {
    expect(migration).toContain("vinpoker_private.read_prize_snapshot");
    expect(migration).toContain("snapshot_prize_amount");
    expect(migration).not.toMatch(
      /create_tournament_prize_payment_request\([\s\S]*?p_prize_amount/,
    );
    expect(migration).not.toMatch(
      /create_tournament_prize_payment_request\([\s\S]*?p_recipient/,
    );
    expect(migration).toContain("p_expected_fingerprint text");
    expect(migration).toContain(
      "v_snapshot ->> 'fingerprint' IS DISTINCT FROM v_expected_fingerprint",
    );
  });

  it("requires literal Floor membership plus grant and different reviewer", () => {
    expect(migration).toMatch(
      /FROM public\.club_floors cf[\s\S]*JOIN public\.club_floor_payout_request_grants g/,
    );
    expect(migration).toContain("reviewer_must_differ");
    expect(migration).toMatch(
      /IF p_decision IS NULL OR p_decision NOT IN \('approve', 'reject'\)/,
    );
    expect(migration).toContain("FOR KEY SHARE OF cf, g");
  });

  it("enforces one pending request, idempotency, immutable events, and terminal transitions", () => {
    expect(migration).toContain("uq_tournament_prize_payment_requests_pending_place");
    expect(migration).toContain("UNIQUE (requested_by, idempotency_key)");
    expect(migration).toContain("payout_request_events_are_append_only");
    expect(migration).toContain("terminal_payout_request_is_immutable");
    expect(migration).toContain("snapshot_changed");
    expect(migration).toContain("superseded");
  });

  it("does not block official prize replacement with snapshot foreign keys", () => {
    expect(migration).toMatch(/snapshot_entry_id\s+uuid\s+NOT NULL,/);
    expect(migration).toMatch(/snapshot_prize_id\s+uuid\s+NOT NULL,/);
    expect(migration).not.toMatch(/snapshot_entry_id[\s\S]{0,120}REFERENCES/);
    expect(migration).not.toMatch(/snapshot_prize_id[\s\S]{0,120}REFERENCES/);
  });

  it("does not grant service_role blanket table deletion", () => {
    expect(migration).not.toMatch(
      /GRANT\s+(?:SELECT,\s*)?DELETE\s+ON TABLE[\s\S]*TO service_role/i,
    );
    expect(migration).toMatch(
      /cleanup_floor_payout_request_fixture\(\s*uuid,\s*uuid\[\],\s*uuid\[\],\s*uuid\[\],\s*uuid\[\],\s*uuid\[\]\s*\)/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cleanup_floor_payout_request_fixture[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cleanup_floor_payout_request_fixture[\s\S]*TO service_role/,
    );
    expect(migration).toContain("p_grant_event_ids uuid[]");
    expect(migration).toContain("cleanup_grant_event_ledger_incomplete");
  });

  it("contains no payment-provider or production action", () => {
    expect(migration).not.toMatch(
      /\b(net\.http|http_post|invoke_edge|functions deploy|db push|vercel --prod)\b/i,
    );
  });

  it("terminates every PL/pgSQL block before its dollar quote", () => {
    expect(migration).not.toMatch(/\bEND\r?\n\$/);
    expect(disposableSql).not.toMatch(/\bEND\r?\n\$/);
  });

  it("keeps mobile actions reachable and announces async states", () => {
    expect(floorRequestPanel).toContain("max-h-[90dvh]");
    expect(floorRequestPanel).toContain("overflow-y-auto");
    expect(floorRequestPanel).toContain("[&>button:last-child]:h-11");
    expect(reviewQueue).toContain("[&>button:last-child]:h-11");
    for (const source of [floorRequestPanel, reviewQueue, permissionsPage]) {
      expect(source).toContain('role="status"');
      expect(source).toContain('role="alert"');
    }
  });

  it("closes a stale review dialog after a failed or concurrent decision", () => {
    expect(reviewQueue).toMatch(
      /catch \(cause\) \{[\s\S]*?setSelected\(null\);[\s\S]*?setReviewNote\(""\);[\s\S]*?refresh\(\);/,
    );
  });
});
