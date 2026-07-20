import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

export function credentialScope({ selectedFunctions = [], deployFrontend = false }) {
  const edgeSelected = selectedFunctions.filter(Boolean).length > 0;
  return {
    GitHub: edgeSelected || deployFrontend ? "IN_SCOPE" : "NOT_IN_SCOPE",
    Supabase: edgeSelected || deployFrontend ? "IN_SCOPE" : "NOT_IN_SCOPE",
    Vercel: deployFrontend ? "IN_SCOPE" : "NOT_IN_SCOPE",
    frontendDeploy: Boolean(deployFrontend),
  };
}

export function requiredCredentialNames(scope) {
  const required = [];
  if (scope.GitHub === "IN_SCOPE") required.push("GITHUB_TOKEN");
  if (scope.Supabase === "IN_SCOPE") {
    required.push("SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF");
  }
  if (scope.frontendDeploy) required.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (scope.Vercel === "IN_SCOPE") required.push("VERCEL_TOKEN");
  return required;
}

export function missingScopedCredentials(scope, environment) {
  return requiredCredentialNames(scope).filter((name) => !environment[name]);
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const selectedFunctions = (args.get("selected-functions") ?? "").split(",").filter(Boolean);
  const deployFrontend = args.get("deploy-frontend") === "true";
  const scope = credentialScope({ selectedFunctions, deployFrontend });
  const missing = missingScopedCredentials(scope, process.env);
  console.log([
    `Credential scope: GitHub=${scope.GitHub}`,
    `Supabase=${scope.Supabase}`,
    `Vercel=${scope.Vercel}`,
    `Frontend deploy=${scope.frontendDeploy}`,
  ].join("; "));
  if (missing.length > 0) {
    console.error(`Missing required scoped credential contexts: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
