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
    const keys = [
      ...contractPropertyNames(`${MARKET}/contracts.ts`),
      ...contractPropertyNames(`${MARKET}/researchRun.ts`),
      ...contractPropertyNames(`${MARKET}/researchArtifact.ts`),
      ...contractPropertyNames(`${MARKET}/comparableResearchArtifact.ts`),
      ...contractPropertyNames(`${MARKET}/gtdStress.ts`),
      ...contractPropertyNames(`${MARKET}/gtdStressComparableAdapter.ts`),
      ...contractPropertyNames(`${MARKET}/gtdStressUiReadModel.ts`),
      ...contractPropertyNames(`${MARKET}/publicSourceCoverage.ts`),
      ...contractPropertyNames(`${MARKET}/vietnamScheduleSupply.ts`),
      ...contractPropertyNames(`${MARKET}/vietnamSupplyReadModel.ts`),
    ].map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const key of keys) {
      for (const blocked of forbidden) expect(key).not.toContain(blocked);
    }
  });

  it("keeps the R1 research contract layer pure and free of later-wave artifacts", () => {
    const source = readFileSync(join(ROOT, `${MARKET}/researchRun.ts`), "utf8");
    expect(source).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
    expect(source).not.toMatch(/\b(?:ResearchArtifact|FoldPrediction|EvaluationReport|ModelCard|GtdStress)\b/);
  });

  it("allows only the named PR4 one-way runtime callers", () => {
    const allowedCallers = new Set([
      "src/App.tsx",
      "src/pages/VerifiedMarketJeju.tsx",
      "src/components/series-market/EvidenceStateBadge.tsx",
      "src/components/series-market/GtdStressSheet.tsx",
      "src/components/series-market/VerifiedMarketDashboard.tsx",
      "src/components/series-market/VerifiedMarketDevPreview.tsx",
      "src/components/series-market/VerifiedMarketEvidenceSheet.tsx",
      "src/components/series-market/VerifiedMarketJejuContent.tsx",
      "src/components/series-market/VietnamMarketPulse.tsx",
      "src/components/series-market/VietnamSupplyContent.tsx",
      "src/components/series-market/VietnamSupplyDashboard.tsx",
      "src/components/series-market/VietnamSupplyEventExplorer.tsx",
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

  it("keeps the R2 emitter source-only, explicit-time, and downstream of frozen Comparable V0 selection", () => {
    const artifact = readFileSync(join(ROOT, `${MARKET}/researchArtifact.ts`), "utf8");
    const adapter = readFileSync(join(ROOT, `${MARKET}/comparableResearchArtifact.ts`), "utf8");
    const emitter = readFileSync(
      join(ROOT, "scripts/series-market/emitComparableV0ResearchArtifact.ts"),
      "utf8",
    );
    for (const source of [artifact, adapter, emitter]) {
      expect(source).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
      expect(source).not.toMatch(/(?:integrations\/supabase|series-registration|cashier|payment|playeridentifier)/i);
    }
    expect(adapter).toContain("evaluateComparableV0(corpus, parameters)");
    expect(adapter).toContain("freezeComparableSelection");
    expect(adapter).toContain("selection.selectedComparableIds");
    expect(adapter).toContain("targetOutcomeClaimIds");
    expect(adapter).toContain("validateResearchArtifactGraph({ artifact, researchGraph })");
    expect(adapter).toContain('status: "exploratory"');
    expect(adapter).toContain("postHocBiasCorrectionApplied: false");
    expect(adapter).not.toMatch(/post.?hoc.+(?:offset|correction).*(?:apply|add)/i);
    expect(emitter).toContain("canonicalize(bundle)");
    expect(emitter).toContain("created-at");
    expect(emitter).toContain("executed-at");
    expect(emitter).not.toContain("jeju_events_seed_v0.csv");
  });

  it("keeps GTD Stress V0 pure, exact, historical-only, and downstream of Comparable evidence", () => {
    const source = readFileSync(join(ROOT, `${MARKET}/gtdStress.ts`), "utf8");
    expect(source).toContain('type: "money"');
    expect(source).toContain("BigInt");
    expect(source).toContain("historical comparable field quantiles");
    expect(source).toContain("sourceArtifactId");
    expect(source).toContain("selectionProtocolId");
    expect(source).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
    expect(source).not.toMatch(/(?:integrations\/supabase|series-registration|cashier|payment|playeridentifier)/i);
    expect(source).not.toMatch(/\bNumber\s*\(\s*(?:gtd|contribution|money|minorUnits|historical)/i);
  });

  it("allows only the trusted Comparable adapter to call the low-level GTD Stress calculator", () => {
    const directCallers = sourceFiles("src")
      .filter((file) => !file.includes(".test.") && file !== `${MARKET}/gtdStress.ts`)
      .filter((file) => importSpecifiers(file).some((specifier) => /(?:^|\/)gtdStress$/.test(specifier)));
    expect(directCallers).toEqual([`${MARKET}/gtdStressComparableAdapter.ts`]);

    const adapter = readFileSync(join(ROOT, `${MARKET}/gtdStressComparableAdapter.ts`), "utf8");
    expect(adapter).toContain("validateResearchArtifactGraph");
    expect(adapter).toContain("createGtdStressScenario");
    expect(adapter).toContain("VERIFIED_JEJU_RELEASE_ID");
    expect(adapter).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
  }, 15_000);

  it("keeps the P2 GTD Stress surface flag-on, read-only, and bound to committed evidence", () => {
    const flags = readFileSync(join(ROOT, "src/lib/featureFlags.ts"), "utf8");
    const content = readFileSync(
      join(ROOT, "src/components/series-market/VerifiedMarketJejuContent.tsx"),
      "utf8",
    );
    const sheet = readFileSync(
      join(ROOT, "src/components/series-market/GtdStressSheet.tsx"),
      "utf8",
    );
    const readModel = readFileSync(join(ROOT, `${MARKET}/gtdStressUiReadModel.ts`), "utf8");
    const researchAttributes = readFileSync(
      join(ROOT, `${MARKET}/datasets/jeju/v1/research/.gitattributes`),
      "utf8",
    );

    expect(flags).toContain("seriesMarketGtdStress: true");
    expect(content).toContain("FEATURES.seriesMarketGtdStress");
    expect(content).toContain("comparable-v0-exact-v1.json?raw");
    expect(content).toContain("createGtdStressEventReadModel");
    expect(readModel).toContain("GTD_STRESS_UI_BUNDLE_FILE_SHA256");
    expect(readModel).toContain("createGtdStressScenarioFromComparableArtifact");
    expect(readModel).toContain('GTD_STRESS_UI_EVALUATION_PROTOCOL_ID = "chronological-v1"');
    expect(researchAttributes).toContain("comparable-v0-exact-v1.json text eol=lf");
    expect(readModel).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
    expect(sheet).not.toMatch(
      /(?:overlay probability|probability of overlay|chance of overlay|probability of reaching GTD|optimal GTD|recommended GTD|safe GTD|expected entries|forecast interval)/i,
    );
  });

  it("keeps D0 public source coverage pure, public-only, and release-scoped", () => {
    const source = readFileSync(join(ROOT, `${MARKET}/publicSourceCoverage.ts`), "utf8");
    const emitter = readFileSync(join(ROOT, "scripts/series-market/emitPublicSourceCoverageAudit.ts"), "utf8");
    expect(source).not.toMatch(/(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i);
    expect(source).not.toMatch(/(?:fx_conversion\s*\(|convertCurrency|exchangeRate|production_action)/i);
    expect(source).toContain("PUBLIC_SOURCE_COVERAGE_PRIVATE_FIELD_KEYS");
    expect(source).toContain("single_market_scope_only");
    expect(source).toContain("no_fx_conversion");
    expect(emitter).not.toMatch(/(?:fetch\s*\(|supabase|react|@\/components|@\/pages|Date\.now)/i);
    expect(emitter).toContain("createPublicSourceCoverageArtifact");
    expect(emitter).toContain("createPublicSourceCoverageReceipt");
  });

  it("keeps D1A Vietnam schedule supply source-only, exact, and outcome-free", () => {
    const source = readFileSync(join(ROOT, `${MARKET}/vietnamScheduleSupply.ts`), "utf8");
    const seed = readFileSync(join(ROOT, `${MARKET}/vietnamScheduleSupplySeed.ts`), "utf8");
    const emitter = readFileSync(
      join(ROOT, "scripts/series-market/emitVietnamScheduleSupplyV1.ts"),
      "utf8",
    );
    for (const contents of [source, seed, emitter]) {
      expect(contents).not.toMatch(
        /(?:Date\.now|Math\.random|randomUUID|fetch\s*\(|supabase|react|@\/components|@\/pages)/i,
      );
      expect(contents).not.toMatch(
        /(?:integrations\/supabase|series-registration|cashier|payment|playeridentifier|privateOperatorData)/i,
      );
      expect(contents).not.toMatch(
        /(?:exchangeRate|convertCurrency|fx_conversion\s*\(|actualEntries|observedTurnout|playerDemand)/i,
      );
    }
    expect(source).toContain("BigInt");
    expect(source).toContain("owner_provided_public_image_unverified");
    expect(source).toContain("sourceSha256");
    expect(source).toContain("visualRegion");
    expect(source).toContain("dash_displayed");
    expect(seed).toContain("rpt_schedule_sep_11_12_2026.png");
    expect(seed).toContain("center_p_schedule_jul_17_2026.png");
    expect(seed).toContain("grand_loyal_schedule_jul_29_2026.png");
    expect(emitter).toContain("verifySourceImages");
    expect(emitter).toContain("createVietnamScheduleSupplyBundle");
    expect(emitter).toContain("createScheduleSupplyReceipt");
  });

  it("keeps the Vietnam supply UI enabled for owner UAT, read-only, corrected-release-only, and lazy", () => {
    const flags = readFileSync(join(ROOT, "src/lib/featureFlags.ts"), "utf8");
    const content = readFileSync(
      join(ROOT, "src/components/series-market/VietnamSupplyContent.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      join(ROOT, "src/components/series-market/VerifiedMarketJejuContent.tsx"),
      "utf8",
    );
    const dashboard = readFileSync(
      join(ROOT, "src/components/series-market/VietnamSupplyDashboard.tsx"),
      "utf8",
    );
    const readModel = readFileSync(join(ROOT, `${MARKET}/vietnamSupplyReadModel.ts`), "utf8");

    expect(flags).toContain("seriesMarketVietnamSupply: true");
    expect(shell).toContain('lazy(() => import("./VietnamSupplyContent"))');
    expect(shell).toContain("FEATURES.seriesMarketVietnamSupply");
    expect(content).toContain("schedule-supply-v1.json?raw");
    expect(content).toContain("d1a-correction-001-center-p-after-dark.json");
    expect(content).not.toContain("vietnamScheduleSupplySeed");
    expect(readModel).toContain("VIETNAM_SUPPLY_CURRENT_RELEASE_ID");
    expect(readModel).toContain("VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID");
    expect(readModel).toContain("VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256");
    expect(readModel).not.toMatch(/(?:fetch\s*\(|supabase|@\/hooks|@\/pages|@\/components)/i);
    expect(readModel).not.toMatch(/(?:actualEntries|observedTurnout|playerDemand)\s*:/i);
    expect(dashboard).not.toMatch(
      /(?:overlay probability|chance of overlay|optimal GTD|recommended GTD|expected entries|forecast interval)/i,
    );

    const candidates = sourceFiles("src").filter((file) => !file.includes(".test."));
    const vietnamArtifactImporters = candidates.filter((file) =>
      importSpecifiers(file).some((specifier) =>
        specifier.includes("series-market/datasets/vietnam/schedule-supply/v1")
      ),
    );
    expect(vietnamArtifactImporters).toEqual([
      "src/components/series-market/VietnamSupplyContent.tsx",
    ]);
  }, 20_000);
});
