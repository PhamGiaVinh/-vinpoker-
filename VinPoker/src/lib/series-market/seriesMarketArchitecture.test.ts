import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const MARKET = "src/lib/series-market";

function sourceFiles(rel: string): string[] {
  const abs = join(ROOT, rel);
  try {
    const out: string[] = [];
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) out.push(...sourceFiles(child));
      else if ([".ts", ".tsx"].includes(extname(entry.name))) out.push(child);
    }
    return out;
  } catch {
    return [];
  }
}

const parse = (rel: string) =>
  ts.createSourceFile(rel, readFileSync(join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true);

function walk(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function importSpecifiers(rel: string): string[] {
  const out: string[] = [];
  walk(parse(rel), (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
  });
  return out;
}

function contractPropertyNames(rel: string): string[] {
  const out: string[] = [];
  walk(parse(rel), (node) => {
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.name) {
      if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) out.push(node.name.text);
    }
  });
  return out;
}

const productionFiles = sourceFiles(MARKET).filter((file) => !file.includes(".test."));

describe("series-market public/private architecture boundary", () => {
  it("public market production modules import only siblings plus the canonical hash primitive", () => {
    const allowedSharedPrimitive = "../series-intelligence/provenanceHash";
    const forbidden = /(?:registration|cashier|player|payment|finance|capture|nativeData|turnoutForecast|forecastProvenance|nowcast)/i;
    for (const file of productionFiles) {
      for (const specifier of importSpecifiers(file)) {
        expect(specifier).not.toMatch(forbidden);
        if (specifier.includes("series-intelligence")) expect(specifier).toBe(allowedSharedPrimitive);
        expect(specifier).not.toMatch(/(?:supabase|integrations\/supabase|@\/components|@\/hooks)/i);
      }
    }
  });

  it("private Series Intelligence modules do not import the public market domain", () => {
    const privateFiles = [
      ...sourceFiles("src/lib/series-intelligence"),
      ...sourceFiles("src/components/series-intelligence"),
      "src/pages/SeriesIntelligence.tsx",
    ];
    for (const file of privateFiles) {
      for (const specifier of importSpecifiers(file)) expect(specifier).not.toContain("series-market");
    }
  });

  it("public contracts expose no PII or private-operator keys", () => {
    const forbidden = [
      "phone",
      "email",
      "playeridentifier",
      "accountidentifier",
      "payment",
      "cashier",
      "wallet",
      "bullethistory",
      "privateregistrationpace",
      "clubfinance",
    ];
    const keys = contractPropertyNames(`${MARKET}/contracts.ts`).map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const key of keys) {
      for (const blocked of forbidden) expect(key).not.toContain(blocked);
    }
  });

  it("has no runtime route, component, feature-flag, or data-release caller in PR1", () => {
    const candidates = sourceFiles("src").filter(
      (file) => !file.includes(".test.") && !file.startsWith(`${MARKET}/`),
    );
    for (const file of candidates) {
      for (const specifier of importSpecifiers(file)) expect(specifier).not.toContain("series-market");
    }
  }, 20_000);

  it("keeps the PR3 generator deterministic and outside runtime integrations", () => {
    const generator = readFileSync(join(ROOT, "scripts/series-market/generateJejuDatasetRelease.ts"), "utf8");
    expect(generator).not.toMatch(/Date\.now|generatedAt|fetch\(|supabase|react|agent|pr4/i);
    expect(generator).toContain("source-manifest.json");
    expect(generator).toContain("canonical/jeju_import_v1.json");
  });
});
