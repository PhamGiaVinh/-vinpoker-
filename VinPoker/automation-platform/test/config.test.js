import test from "node:test";
import assert from "node:assert/strict";
import { assertRuntimeSecrets, loadConfig } from "../src/config.js";

test("runtime rejects weak or incomplete HMAC key material", () => {
  assert.throws(
    () =>
      assertRuntimeSecrets(
        loadConfig({
          currentKeyId: "dev-current",
          currentKey: "too-short",
        }),
      ),
    /at least 32 bytes/,
  );

  assert.throws(
    () =>
      assertRuntimeSecrets(
        loadConfig({
          currentKeyId: "dev-current",
          currentKey: "current-key-with-at-least-32-bytes-of-material",
          nextKeyId: "dev-next",
          nextKey: "",
        }),
      ),
    /configured together/,
  );
});
