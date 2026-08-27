import { defineConfig } from "vitest/config";

// This CRITICAL migration contract is intentionally isolated from the broad
// jsdom/i18n suite. It keeps local verification bounded on low-memory devices
// and remains the same source test run by the disposable-PostgreSQL CI job.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/floorTableControlV3/serverContract.contract.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
