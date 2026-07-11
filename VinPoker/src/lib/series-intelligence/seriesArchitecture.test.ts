// A6 — static architecture guards for Series Intelligence, AST-aware (TypeScript compiler API) so they never
// trip on comments, strings, or legitimate UI copy. They prove ONE feature registry, ONE capability gate, and
// ONE walk-forward path, and that outcome/actual data cannot enter the feature plane. No runtime behaviour.
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_FEATURE_KEYS, classify } from "./featureBoundary";

const SI = "src/lib/series-intelligence";
const parse = (rel: string) =>
  ts.createSourceFile(rel, readFileSync(join(process.cwd(), rel), "utf8"), ts.ScriptTarget.Latest, true);

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}
function importSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
  });
  return out;
}
function stringLiterals(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
  });
  return out;
}
function identifiers(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  walk(sf, (n) => {
    if (ts.isIdentifier(n)) out.add(n.text);
  });
  return out;
}
/** Every declared callable name — function declarations AND arrow/function-expression consts — so a second
 *  implementation cannot hide as `const walkForwardX = () => …`. */
function declaredCallableNames(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) out.push(n.name.text);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      out.push(n.name.text);
    }
  });
  return out;
}
/** Numeric literals in DECLARATIONS (const X = 8 / { key: 12 }) — catches a threshold re-declared under a new
 *  identifier, which the comparison scan alone would miss. */
function declaredNumericLiterals(sf: ts.SourceFile): number[] {
  const out: number[] = [];
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isNumericLiteral(n.initializer)) out.push(Number(n.initializer.text));
    if (ts.isPropertyAssignment(n) && ts.isNumericLiteral(n.initializer)) out.push(Number(n.initializer.text));
  });
  return out;
}
function objectLiteralKeys(sf: ts.SourceFile, varName: string): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === varName &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const p of n.initializer.properties) {
        if (ts.isPropertyAssignment(p)) {
          if (ts.isIdentifier(p.name)) out.push(p.name.text);
          else if (ts.isStringLiteral(p.name)) out.push(p.name.text);
        }
      }
    }
  });
  return out;
}
const CMP = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);
function comparisonNumericLiterals(sf: ts.SourceFile): number[] {
  const out: number[] = [];
  walk(sf, (n) => {
    if (ts.isBinaryExpression(n) && CMP.has(n.operatorToken.kind)) {
      for (const side of [n.left, n.right]) if (ts.isNumericLiteral(side)) out.push(Number(side.text));
    }
  });
  return out;
}

describe("A6 registry authority", () => {
  it("every production model feature id resolves through the canonical registry as static_known", () => {
    for (const k of MODEL_FEATURE_KEYS) expect(classify(k)).toBe("static_known");
  });
  it("FEATURE_REGISTRY ids are unique (no silent overwrite) and stable machine identifiers (not UI labels)", () => {
    const keys = objectLiteralKeys(parse(`${SI}/featureBoundary.ts`), "FEATURE_REGISTRY");
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
  });
  it("outcome quantities are outcome_only in the registry — they can never be a model feature", () => {
    for (const id of ["finalEntries", "totalEntries", "finalRake", "finalFnb", "finalOverlay", "prizePoolActual"]) {
      expect(classify(id)).toBe("outcome_only");
    }
  });
  it("no module keeps a PRIVATE availability list — the class literals live only in featureBoundary", () => {
    const CLASSES = ["static_known", "observed_by_origin", "outcome_only"];
    for (const rel of ["turnoutForecast.ts", "overlayRiskEngine.ts", "baselineBattery.ts", "modelCapability.ts"]) {
      const lits = stringLiterals(parse(`${SI}/${rel}`));
      for (const c of CLASSES) expect(lits).not.toContain(c);
    }
  });
});

describe("A6 import / dependency guards", () => {
  it("featureBoundary is the authority — it imports NO project module (no scoring/actual/outcome layer)", () => {
    const specs = importSpecifiers(parse(`${SI}/featureBoundary.ts`));
    expect(specs.filter((s) => s.startsWith("."))).toEqual([]);
  });
  it("baseline predictors reuse canonicalCvFolds + the capability gate; import no outcome/scoring module", () => {
    const sf = parse(`${SI}/baselineBattery.ts`);
    const specs = importSpecifiers(sf);
    expect(specs).toContain("./turnoutForecast");
    expect(specs).toContain("./modelCapability");
    for (const s of specs) expect(s).not.toMatch(/outcome|scoring|actual/i);
    expect(identifiers(sf).has("canonicalCvFolds")).toBe(true); // consumed, not re-derived
    expect(identifiers(sf).has("trainRows")).toBe(false); // no private train split
  });

  it("turnout feature construction DEPENDS ON featureBoundary (admits through the boundary)", () => {
    expect(importSpecifiers(parse(`${SI}/turnoutForecast.ts`))).toContain("./featureBoundary");
  });

  it("the forecast engine never reads final/outcome quantities (rake/F&B/overlay/service-fee) as inputs", () => {
    // registry outcome-feature ids (camelCase) must not appear as identifiers in the engine; the target label
    // total_entries is intentionally excluded (it is the y-label joined in scoring, not a model feature).
    const ids = identifiers(parse(`${SI}/turnoutForecast.ts`));
    for (const outcomeId of ["finalRake", "finalFnb", "finalOverlay", "finalServiceFee", "finalPrizePool", "finalItmCount"]) {
      expect(ids.has(outcomeId)).toBe(false);
    }
  });
});

describe("A6 single-implementation guards", () => {
  it("walk-forward is implemented ONLY in turnoutForecast (no second CV loop elsewhere, incl. arrow consts)", () => {
    for (const rel of ["baselineBattery.ts", "overlayRiskEngine.ts", "modelCapability.ts", "featureBoundary.ts"]) {
      for (const fn of declaredCallableNames(parse(`${SI}/${rel}`))) expect(fn).not.toMatch(/^walkForward/);
    }
    expect(declaredCallableNames(parse(`${SI}/turnoutForecast.ts`)).some((f) => f.startsWith("walkForward"))).toBe(true);
  });
  it("the sample-size thresholds live only in modelCapability — not re-declared/compared in the engines", () => {
    for (const rel of ["turnoutForecast.ts", "baselineBattery.ts", "overlayRiskEngine.ts"]) {
      const ids = identifiers(parse(`${SI}/${rel}`));
      expect(ids.has("MIN_FULL")).toBe(false);
      expect(ids.has("HIGH_N")).toBe(false);
      expect(ids.has("CV_MIN_TRAIN")).toBe(false);
    }
    // no bare 8/12 sample-size ladder reintroduced in the forecast / baseline engines — scanned both as a
    // COMPARISON operand AND as a DECLARATION initializer (so a threshold re-declared under a new name is also
    // caught). 4 is intentionally not scanned — too common; CV_MIN_TRAIN absence + MIN_TRAIN_LENGTH import covers it.
    for (const rel of ["turnoutForecast.ts", "baselineBattery.ts"]) {
      const sf = parse(`${SI}/${rel}`);
      for (const lit of [...comparisonNumericLiterals(sf), ...declaredNumericLiterals(sf)]) {
        expect(lit).not.toBe(8);
        expect(lit).not.toBe(12);
      }
    }
  });
  it("the baseline battery still reduces over the canonical machinery (imports it, no new Date split)", () => {
    const sf = parse(`${SI}/baselineBattery.ts`);
    expect(identifiers(sf).has("canonicalCvFolds")).toBe(true);
    // no independent date split: the battery never parses dates itself
    let usesNewDate = false;
    walk(sf, (n) => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date") usesNewDate = true;
    });
    expect(usesNewDate).toBe(false);
  });
});
