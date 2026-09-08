import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/dealerAssignmentSessionCompat/migration.contract.test.ts"],
  },
});
