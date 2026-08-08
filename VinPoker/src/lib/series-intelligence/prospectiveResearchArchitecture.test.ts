import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "src");
const kernel = readFileSync(resolve(ROOT, "lib/series-intelligence/prospectiveResearchCohortV1.ts"), "utf8");
const component = readFileSync(resolve(ROOT, "components/series-intelligence/ProspectiveResearchQueue.tsx"), "utf8");
const flags = readFileSync(resolve(ROOT, "lib/featureFlags.ts"), "utf8");
const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("D3A architecture boundary", () => {
  it("keeps the pure cohort kernel free of React, Supabase and direct writes", () => {
    expect(kernel).not.toMatch(/from ["'].*(?:react|supabase|integrations\/supabase)["']/i);
    expect(kernel).not.toMatch(/\.(?:insert|update|upsert|delete)\s*\(/);
    expect(kernel).not.toContain("Date.now(");
    expect(kernel).not.toContain("Math.random(");
  });

  it("uses the existing forecast and provenance seams", () => {
    expect(kernel).toContain('from "./forecastProvenance"');
    expect(kernel).toContain('from "./turnoutForecast"');
    expect(kernel).toContain("buildForecastProvenance");
    expect(kernel).toContain("forecastTurnout");
  });

  it("keeps commit identity separate from the human-readable build timestamp", () => {
    expect(viteConfig).toContain("__APP_GIT_COMMIT_SHA__");
    expect(viteConfig).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(viteConfig).toContain("GITHUB_SHA");
    expect(viteConfig).toContain("execFileSync(\"git\", [\"rev-parse\", \"HEAD\"]");
    expect(viteConfig).not.toMatch(/__APP_GIT_COMMIT_SHA__:\s*JSON\.stringify\(buildVersion\)/);
  });

  it("keeps capture and native promotion behind existing boundaries", () => {
    expect(component).toContain("hook.insertForecast");
    expect(component).toContain("promoteNativeEventActual");
    expect(component).toContain("getBuildGitSha");
    expect(component).not.toContain("VITE_GIT_COMMIT_SHA");
    expect(component).not.toContain("d3a:native:${event.eventId}");
    expect(component).not.toMatch(/from ["'].*(?:supabase|integrations\/supabase)["']/i);
    expect(component).not.toMatch(/\.from\s*\(/);
  });

  it("ships with the prospective queue disabled", () => {
    expect(flags).toMatch(/seriesProspectiveResearchCohortV1:\s*false/);
  });

  it("does not expose money-action or recommendation language", () => {
    expect(component).not.toMatch(/optimal|recommended|probability|GTD recommendation|money action/i);
  });
});
