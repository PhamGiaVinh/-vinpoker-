import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, parseTargetList } from "./deployment-manifest.mjs";

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIdentifier(identifier) {
  return identifier.replaceAll('"', "").toLowerCase();
}

function splitArguments(argumentSource) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of argumentSource) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function argumentName(argument) {
  const withoutMode = argument.replace(/^\s*(?:inout|in|out|variadic)\s+/i, "").trim();
  const match = withoutMode.match(/^("[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)\s+/);
  return match ? normalizeIdentifier(match[1]) : null;
}

export function schemaInventory(schemaSql) {
  const relations = new Set();
  const relationBodies = new Map();
  const functions = new Map();

  const relationPattern = /CREATE\s+(?:UNLOGGED\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)(?:\s*\((.*?)\)\s*;|\s+AS\b)/gis;
  for (const match of schemaSql.matchAll(relationPattern)) {
    const name = normalizeIdentifier(match[1]);
    relations.add(name);
    if (match[2] !== undefined) relationBodies.set(name, match[2]);
  }

  const functionPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)\s*\((.*?)\)\s*RETURNS\b/gis;
  for (const match of schemaSql.matchAll(functionPattern)) {
    const name = normalizeIdentifier(match[1]);
    const names = splitArguments(match[2]).map(argumentName);
    const signatures = functions.get(name) ?? [];
    signatures.push(names);
    functions.set(name, signatures);
  }

  return { relations, relationBodies, functions };
}

export function findMissingContracts(schemaSql, contracts) {
  const inventory = schemaInventory(schemaSql);
  const missing = [];

  for (const contract of contracts) {
    const name = normalizeIdentifier(contract.name);
    if (contract.type === "relation") {
      if (!inventory.relations.has(name)) missing.push(`${contract.type}:${contract.name}`);
      continue;
    }
    if (contract.type === "column") {
      const relation = normalizeIdentifier(contract.relation);
      const body = inventory.relationBodies.get(relation);
      const columnPattern = new RegExp(`^\\s*"?${escapeRegExp(contract.name)}"?\\s+`, "im");
      if (!body || !columnPattern.test(body)) missing.push(`${contract.type}:${contract.relation}.${contract.name}`);
      continue;
    }
    if (contract.type === "function") {
      const signatures = inventory.functions.get(name) ?? [];
      const expectedArguments = contract.arguments?.map(normalizeIdentifier);
      const matched = expectedArguments === undefined
        ? signatures.length > 0
        : signatures.some((actual) => actual.length === expectedArguments.length
          && actual.every((argument, index) => argument === expectedArguments[index]));
      if (!matched) {
        const suffix = expectedArguments === undefined ? "" : `(${expectedArguments.join(",")})`;
        missing.push(`${contract.type}:${contract.name}${suffix}`);
      }
      continue;
    }
    missing.push(`unsupported:${contract.type ?? "unknown"}`);
  }

  return missing;
}

function contractsForTargets(manifest, rawTargets) {
  if (rawTargets === "frontend") return manifest.frontend.contracts;
  const targets = parseTargetList(rawTargets);
  if (targets.length === 0) throw new Error("at least one probe target is required");
  return targets.flatMap((target) => {
    const config = manifest.functions[target];
    if (!config) throw new Error(`unknown deployment target: ${target}`);
    return config.contracts;
  });
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = args.get("schema");
  const rawTargets = args.get("targets");
  if (!schemaPath || !rawTargets) throw new Error("schema and targets are required");

  const manifest = loadDeploymentManifest();
  const contracts = contractsForTargets(manifest, rawTargets);
  const schemaSql = readFileSync(schemaPath, "utf8");
  const missing = findMissingContracts(schemaSql, contracts);
  if (missing.length > 0) {
    console.error("Live schema contract probe failed:");
    for (const contract of [...new Set(missing)].sort()) console.error(`- ${contract}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Live schema contract probe passed (${contracts.length} checks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
