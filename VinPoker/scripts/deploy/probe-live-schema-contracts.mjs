import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDeploymentManifest,
  mergeContracts,
  parseTargetList,
  resolveContractProfile,
} from "./deployment-manifest.mjs";
import { selectTargetContractProfile } from "./target-contract-profile.mjs";
import { inspectImportGraph } from "./verify-target-source.mjs";

const FRONTEND_CONTRACT_FILES = [
  "VinPoker/src/components/cashier/DealerSwingTab.tsx",
  "VinPoker/src/lib/dealerMassOpen.ts",
];

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
  return identifier.replaceAll('"', "").trim().toLowerCase();
}

function normalizeType(type) {
  return type
    .replaceAll('"', "")
    .replace(/\bpg_catalog\./gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function argumentParts(argument) {
  const withoutMode = argument.replace(/^\s*(?:inout|in|out|variadic)\s+/i, "").trim();
  const match = withoutMode.match(/^("[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)\s+([\s\S]+)$/);
  if (!match) return { name: null, type: normalizeType(withoutMode.replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")) };
  return {
    name: normalizeIdentifier(match[1]),
    type: normalizeType(match[2].replace(/\s+(?:DEFAULT|=)[\s\S]*$/i, "")),
  };
}

function signatureKey(name, argumentTypes) {
  return `${normalizeIdentifier(name)}(${argumentTypes.map(normalizeType).join(",")})`;
}

function aclState() {
  return { publicExecute: true, grants: new Set() };
}

function parseAcl(schemaSql, knownSignatures) {
  const bySignature = new Map([...knownSignatures].map((key) => [key, aclState()]));
  const aclPattern = /(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+([^\s(]+)\s*\((.*?)\)\s+(?:TO|FROM)\s+([^;]+);/gis;
  for (const match of schemaSql.matchAll(aclPattern)) {
    // pg_dump includes argument names in ACL signatures, while hand-authored
    // GRANT/REVOKE statements commonly contain types only. Normalize both.
    const argumentTypes = splitArguments(match[3]).map((argument) => argumentParts(argument).type);
    const key = signatureKey(match[2], argumentTypes);
    const state = bySignature.get(key) ?? aclState();
    const roles = match[4].split(",").map(normalizeIdentifier);
    for (const role of roles) {
      if (role === "public") state.publicExecute = match[1].toUpperCase() === "GRANT";
      else if (match[1].toUpperCase() === "GRANT") state.grants.add(role);
      else state.grants.delete(role);
    }
    bySignature.set(key, state);
  }
  return bySignature;
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

  const signatureKeys = new Set();
  const functionPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)\s*\((.*?)\)\s*RETURNS\b/gis;
  for (const match of schemaSql.matchAll(functionPattern)) {
    const name = normalizeIdentifier(match[1]);
    const parts = splitArguments(match[2]).map(argumentParts);
    const signatures = functions.get(name) ?? [];
    const signature = {
      argumentNames: parts.map((item) => item.name),
      argumentTypes: parts.map((item) => item.type),
    };
    signature.key = signatureKey(name, signature.argumentTypes);
    signatureKeys.add(signature.key);
    signatures.push(signature);
    functions.set(name, signatures);
  }

  return { relations, relationBodies, functions, aclBySignature: parseAcl(schemaSql, signatureKeys) };
}

function effectiveExecute(acl, role) {
  return acl.publicExecute || acl.grants.has(normalizeIdentifier(role));
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
      const expectedTypes = contract.argumentTypes?.map(normalizeType);
      const matched = signatures.filter((signature) => {
        if (expectedArguments && (signature.argumentNames.length !== expectedArguments.length
            || !signature.argumentNames.every((argument, index) => argument === expectedArguments[index]))) return false;
        if (expectedTypes && (signature.argumentTypes.length !== expectedTypes.length
            || !signature.argumentTypes.every((argument, index) => argument === expectedTypes[index]))) return false;
        return true;
      });
      if (matched.length === 0) {
        const suffix = expectedArguments === undefined ? "" : `(${expectedArguments.join(",")})`;
        missing.push(`${contract.type}:${contract.name}${suffix}`);
        continue;
      }
      if (contract.allowOtherOverloads === false && signatures.length !== 1) {
        missing.push(`overload:${contract.name}:expected_exactly_one_found_${signatures.length}`);
      }
      if (contract.acl) {
        for (const signature of matched) {
          const acl = inventory.aclBySignature.get(signature.key) ?? aclState();
          for (const [role, expected] of Object.entries(contract.acl)) {
            const actual = effectiveExecute(acl, role);
            if (actual !== expected) {
              missing.push(`acl:${contract.name}(${signature.argumentTypes.join(",")}):${role}:expected_${expected ? "allow" : "deny"}`);
            }
          }
        }
      }
      continue;
    }
    missing.push(`unsupported:${contract.type ?? "unknown"}`);
  }

  return missing;
}

function staticDatabaseContracts(files, targetRoot, dependencyKind) {
  const relations = new Map();
  const functions = new Map();
  const addEvidence = (map, name, file) => {
    const evidenceFiles = map.get(name) ?? new Set();
    evidenceFiles.add(file);
    map.set(name, evidenceFiles);
  };
  for (const file of files) {
    const source = readFileSync(resolve(targetRoot, file), "utf8");
    for (const match of source.matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      addEvidence(relations, `public.${match[1]}`, file);
    }
    for (const match of source.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)) {
      addEvidence(functions, `public.${match[1]}`, file);
    }
    for (const match of source.matchAll(/dealerMassOpenRpc(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      addEvidence(functions, `public.${match[1]}`, file);
    }
  }
  return [
    ...[...relations.entries()].map(([name, evidence]) => ({
      type: "relation", name, dependencyKind, evidenceFiles: [...evidence].sort(),
    })),
    ...[...functions.entries()].map(([name, evidence]) => ({
      type: "function", name, dependencyKind, evidenceFiles: [...evidence].sort(),
    })),
  ];
}

export function sourceContractsForFunction({ targetRoot, config }) {
  const entrypoint = resolve(targetRoot, config.path, "index.ts");
  const files = inspectImportGraph(entrypoint, targetRoot);
  return staticDatabaseContracts(files, targetRoot, "direct_imported_graph");
}

export function sourceContractsForFrontend({ targetRoot }) {
  const files = FRONTEND_CONTRACT_FILES.filter((file) => existsSync(resolve(targetRoot, file)));
  return staticDatabaseContracts(files, targetRoot, "direct_frontend_source");
}

export function contractsForTargets({ manifest, rawTargets, targetRoot }) {
  const selection = selectTargetContractProfile({ targetRoot });
  const resolved = resolveContractProfile(manifest, selection.profile);
  if (rawTargets === "frontend") {
    return {
      selection,
      contracts: mergeContracts(sourceContractsForFrontend({ targetRoot }), resolved.frontend),
    };
  }
  const targets = parseTargetList(rawTargets);
  if (targets.length === 0) throw new Error("at least one probe target is required");
  const contracts = targets.flatMap((target) => {
    const config = manifest.functions[target];
    if (!config) throw new Error(`unknown deployment target: ${target}`);
    return mergeContracts(sourceContractsForFunction({ targetRoot, config }), resolved.functions[target]);
  });
  return { selection, contracts: mergeContracts(contracts) };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = args.get("schema");
  const rawTargets = args.get("targets");
  const targetRoot = args.get("target-root");
  if (!schemaPath || !rawTargets || !targetRoot) throw new Error("schema, targets and target-root are required");

  const manifest = loadDeploymentManifest();
  const { selection, contracts } = contractsForTargets({ manifest, rawTargets, targetRoot });
  const schemaSql = readFileSync(schemaPath, "utf8");
  const missing = findMissingContracts(schemaSql, contracts);
  if (missing.length > 0) {
    console.error(`Live schema contract probe failed for ${selection.profile}:`);
    for (const contract of [...new Set(missing)].sort()) console.error(`- ${contract}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Live schema contract probe passed for ${selection.profile} (${contracts.length} checks, ${selection.sourceFingerprint}).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
