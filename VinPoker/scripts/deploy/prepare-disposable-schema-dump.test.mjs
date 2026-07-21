import assert from "node:assert/strict";
import test from "node:test";

import { normalizeForPostgres16 } from "./prepare-disposable-schema-dump.mjs";

test("PG16 disposable preparation removes only unsupported MAINTAIN privileges", () => {
  const source = [
    'GRANT SELECT,MAINTAIN ON TABLE "public"."club_intel_config" TO "authenticated";\n',
    'GRANT ALL ON TABLE "public"."dealer_shift_metrics" TO "service_role";\n',
    'GRANT MAINTAIN ON TABLE "public"."obsolete" TO "authenticated";\n',
  ].join("");
  assert.equal(normalizeForPostgres16(source), [
    'GRANT SELECT ON TABLE "public"."club_intel_config" TO "authenticated";\n',
    'GRANT ALL ON TABLE "public"."dealer_shift_metrics" TO "service_role";\n',
    '-- PG16 disposable compatibility: stripped unsupported MAINTAIN privilege: GRANT MAINTAIN ON TABLE "public"."obsolete" TO "authenticated";\n',
  ].join(""));
});

test("PG16 disposable preparation strips only the unsupported transaction_timeout setting", () => {
  const source = [
    'SET transaction_timeout = 0;\n',
    'SET statement_timeout = 0;\n',
  ].join("");
  assert.equal(normalizeForPostgres16(source), [
    '-- PG16 disposable compatibility: stripped unsupported transaction_timeout setting: SET transaction_timeout = 0;\n',
    'SET statement_timeout = 0;\n',
  ].join(""));
});
