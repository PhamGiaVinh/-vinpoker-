import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPS_MODULE_REGISTRY } from "@/ops/registry/opsModuleRegistry";

const opsApp = readFileSync(resolve(import.meta.dirname, "../../OpsApp.tsx"), "utf8");

describe("Ops route and registry completeness", () => {
  it("maps every module root and child gate to exactly one registry definition", () => {
    const registryIds = new Set(OPS_MODULE_REGISTRY.map((module) => module.id));
    for (const module of OPS_MODULE_REGISTRY) {
      const gate = new RegExp(`capability=["']${module.id}["']`, "gu");
      expect(opsApp.match(gate)?.length ?? 0, module.id).toBeGreaterThanOrEqual(1);
      expect(opsApp).toContain(`path="${module.route}"`);
    }
    const gatedIds = [...opsApp.matchAll(/capability=["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(gatedIds.every((id) => registryIds.has(id as never))).toBe(true);
  });

  it("does not mount child module code for blocked or disabled modules", () => {
    for (const module of OPS_MODULE_REGISTRY.filter(
      (item) => item.defaultState === "BLOCKED" || item.defaultState === "DISABLED",
    )) {
      expect(opsApp).toContain(`<OpsModuleGate capability="${module.id}" />`);
    }
    expect(opsApp).not.toMatch(/lazy\(\(\) => import\("@\/pages\/ops\/(?:OpsFnb|OpsMarketing|OpsAccounting)"\)\)/u);
  });

  it("keeps Accounting Control out of the registry and redirects its legacy Ops URL", () => {
    expect(OPS_MODULE_REGISTRY.some((module) => module.id === ("accounting" as never))).toBe(false);
    expect(opsApp).toContain('path="/ops/accounting" element={<Navigate to="/ops/finance" replace />}');
  });
});
