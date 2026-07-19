function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

const defaultRoot = decodeURIComponent(new URL("../../..", import.meta.url).pathname).replace(/^\/(.:\/)/, "$1");
const root = Deno.env.get("TARGET_REPO_ROOT") ?? defaultRoot;
const targets = JSON.parse(Deno.env.get("TARGET_FUNCTIONS") ?? '["process-swing","mass-assign","checkout-dealer"]') as string[];
const manifestPath = Deno.env.get("CONTROL_PLANE_MANIFEST")
  ?? decodeURIComponent(new URL("./deployment-contracts.json", import.meta.url).pathname).replace(/^\/(.:\/)/, "$1");

Deno.test("exact target source exposes every selected critical Edge entrypoint", async () => {
  assert(root, "TARGET_REPO_ROOT is required");
  assert(manifestPath, "CONTROL_PLANE_MANIFEST is required");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  for (const name of targets) {
    const config = manifest.functions[name];
    assert(config?.critical, `${name} must remain critical in the current manifest`);
    const stat = await Deno.stat(`${root}/${config.path}/index.ts`);
    assert(stat.isFile, `${name} index.ts must be a file`);
  }
});

Deno.test("current manifest keeps the approved JWT posture for rollback source", async () => {
  assert(manifestPath, "CONTROL_PLANE_MANIFEST is required");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  assertEquals(manifest.functions["process-swing"].verifyJwt, false);
  assertEquals(manifest.functions["mass-assign"].verifyJwt, true);
  assertEquals(manifest.functions["checkout-dealer"].verifyJwt, true);
});
