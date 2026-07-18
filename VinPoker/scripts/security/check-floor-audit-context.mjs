function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSameOrChildDomain(candidate, domain) {
  return candidate === domain || candidate.endsWith(`.${domain}`);
}

export function validateFloorAuditContext(environment = process.env) {
  const failures = [];
  const required = [
    "FLOOR_UAT_ENV",
    "FLOOR_UAT_SUPABASE_URL",
    "FLOOR_UAT_PROJECT_REF",
    "FLOOR_UAT_PRODUCTION_PROJECT_REF",
    "FLOOR_UAT_BASE_URL",
    "FLOOR_UAT_PRODUCTION_DOMAIN",
    "FLOOR_UAT_FIXTURE_PREFIX",
    "GITHUB_REF",
  ];

  for (const name of required) {
    if (!environment[name]) failures.push(`missing:${name}`);
  }
  if (failures.length > 0) return failures;

  if (environment.FLOOR_UAT_ENV !== "preview") {
    failures.push("FLOOR_UAT_ENV must equal preview");
  }
  if (environment.GITHUB_REF === "refs/heads/main") {
    failures.push("GITHUB_REF must not be refs/heads/main");
  }
  if (!environment.FLOOR_UAT_FIXTURE_PREFIX.startsWith("CODEX_FLOOR_UAT_")) {
    failures.push("FLOOR_UAT_FIXTURE_PREFIX must start with CODEX_FLOOR_UAT_");
  }

  const supabaseHost = hostname(environment.FLOOR_UAT_SUPABASE_URL);
  if (!supabaseHost || !supabaseHost.endsWith(".supabase.co")) {
    failures.push("FLOOR_UAT_SUPABASE_URL must be a Supabase HTTPS URL");
  }
  const refFromUrl = supabaseHost?.split(".")[0];
  if (environment.FLOOR_UAT_PROJECT_REF === environment.FLOOR_UAT_PRODUCTION_PROJECT_REF) {
    failures.push("FLOOR_UAT_PROJECT_REF must not match the production project");
  }
  if (refFromUrl === environment.FLOOR_UAT_PRODUCTION_PROJECT_REF) {
    failures.push("FLOOR_UAT_SUPABASE_URL must not point at the production project");
  }
  if (refFromUrl && refFromUrl !== environment.FLOOR_UAT_PROJECT_REF) {
    failures.push("FLOOR_UAT_SUPABASE_URL project ref must match FLOOR_UAT_PROJECT_REF");
  }

  const baseHost = hostname(environment.FLOOR_UAT_BASE_URL);
  const productionDomain = environment.FLOOR_UAT_PRODUCTION_DOMAIN.toLowerCase();
  if (!baseHost) {
    failures.push("FLOOR_UAT_BASE_URL must be a valid URL");
  } else if (isSameOrChildDomain(baseHost, productionDomain)) {
    failures.push("FLOOR_UAT_BASE_URL must not use the production domain");
  }

  return failures;
}

function run() {
  const failures = validateFloorAuditContext();
  if (failures.length === 0) {
    console.log("Floor audit context guard passed.");
    return;
  }

  console.error("Floor audit context guard blocked this run:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
import { fileURLToPath } from "node:url";
