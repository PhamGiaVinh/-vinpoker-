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

function interfacePropertyNames(rel: string, interfaceName: string): string[] {
  const out: string[] = [];
  walk(parse(rel), (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
          out.push(member.name.text);
        }
      }
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

  it("allows only the named PR4 one-way runtime callers", () => {
    const allowedCallers = new Set([
      "src/App.tsx",
      "src/pages/VerifiedMarketJeju.tsx",
      "src/components/series-market/EvidenceStateBadge.tsx",
      "src/components/series-market/VerifiedMarketDashboard.tsx",
      "src/components/series-market/VerifiedMarketDevPreview.tsx",
      "src/components/series-market/VerifiedMarketEvidenceSheet.tsx",
      "src/components/series-market/VerifiedMarketJejuContent.tsx",
    ]);
    const candidates = sourceFiles("src").filter(
      (file) => !file.includes(".test.") && !file.startsWith(`${MARKET}/`),
    );
    for (const file of candidates) {
      for (const specifier of importSpecifiers(file)) {
        if (specifier.includes("series-market")) expect(allowedCallers.has(file), file).toBe(true);
      }
    }
  }, 20_000);

  it("keeps committed Jeju artifacts in the lazy content module only", () => {
    const artifactOwner = "src/components/series-market/VerifiedMarketJejuContent.tsx";
    const candidates = sourceFiles("src").filter((file) => !file.includes(".test."));
    const artifactImporters = candidates.filter((file) =>
      readFileSync(join(ROOT, file), "utf8").includes("series-market/datasets/jeju/v1"),
    );
    expect(artifactImporters).toEqual([artifactOwner]);
    for (const file of ["src/App.tsx", "src/pages/ClubAdmin.tsx", "src/components/Layout.tsx"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).not.toContain("jeju_import_v1.json");
      expect(source).not.toContain("source-manifest.json");
      expect(source).not.toContain("data-quality.json");
    }
  }, 20_000);

  it("keeps the public read model and UI free of network, Supabase, and private Series Intelligence", () => {
    const readModel = readFileSync(join(ROOT, `${MARKET}/verifiedMarketReadModel.ts`), "utf8");
    expect(readModel).not.toMatch(/(?:react|vite|fetch\s*\(|supabase|@\/hooks|@\/pages|@\/components)/i);
    expect(readModel).not.toMatch(/(?:capture|forecast|nowcast|calibration|registration|cashier|payment|clubFinance)/i);
    expect(readModel).not.toMatch(/\bNumber\s*\(/);

    const runtimeFiles = [
      ...sourceFiles("src/components/series-market"),
      "src/pages/VerifiedMarketJeju.tsx",
    ].filter((file) => !file.includes(".test."));
    for (const file of runtimeFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/fetch\s*\(|integrations\/supabase|from\s+["']@\/lib\/supabase/i);
    }
  });

  it("keeps the visual harness DEV-gated and the owner route lazy", () => {
    const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
    expect(app).toContain('lazy(() => import("./pages/VerifiedMarketJeju"))');
    expect(app).toContain('path="/club/admin/market-intelligence"');
    expect(app).toContain('path="/__dev/series-market"');
    expect(app).toMatch(/DevSeriesMarketPreview\s*=\s*import\.meta\.env\.DEV/);
  });

  it("keeps the PR3 generator deterministic and outside runtime integrations", () => {
    const generator = readFileSync(join(ROOT, "scripts/series-market/generateJejuDatasetRelease.ts"), "utf8");
    expect(generator).not.toMatch(/Date\.now|generatedAt|fetch\(|supabase|react|agent|pr4/i);
    expect(generator).toContain("source-manifest.json");
    expect(generator).toContain("canonical/jeju_import_v1.json");
  });

  it("keeps Comparable Event Engine V0 as a pure, outcome-separated research module", () => {
    const engine = readFileSync(join(ROOT, `${MARKET}/comparableEvent.ts`), "utf8");
    const evaluator = readFileSync(join(ROOT, "scripts/series-market/evaluateComparableV0.ts"), "utf8");
    const selectionKeys = interfacePropertyNames(`${MARKET}/comparableEvent.ts`, "ComparableSelectionInput");
    expect(selectionKeys).not.toContain("entries");
    expect(interfacePropertyNames(`${MARKET}/comparableEvent.ts`, "ComparableOutcome")).toContain("entries");
    expect(engine).toContain("selectedOutcomes(corpus, selection.selectedComparableIds)");
    expect(engine).toContain("chronologyOriginDate");
    expect(engine).toContain("excludedFestivalIds");
    for (const source of [engine, evaluator]) {
      expect(source).not.toMatch(/(?:fetch\s*\(|supabase|react|@\/components|@\/pages|agent|Date\.now|Math\.random|jeju_events_seed_v0\.csv)/i);
    }
    expect(evaluator).toContain("buildJejuComparableCorpus");
    expect(evaluator).toContain("evaluateComparableV0");
  });
});
