import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function normalizeForPostgres16(schemaSql) {
  return schemaSql.split(/(\r?\n)/).map((line) => {
    if (/^\s*SET\s+transaction_timeout\s*=\s*.+;\s*$/i.test(line)) {
      return `-- PG16 disposable compatibility: stripped unsupported transaction_timeout setting: ${line.trim()}`;
    }
    const grant = line.match(/^(\s*(?:GRANT|REVOKE)\s+)([^;]+?)(\s+ON\s+(?:TABLE|SEQUENCE|FUNCTION)\b[\s\S]*)$/i);
    if (!grant) return line;
    const privileges = grant[2].split(",").map((privilege) => privilege.trim()).filter(Boolean);
    if (!privileges.some((privilege) => privilege.toUpperCase() === "MAINTAIN")) return line;
    const compatiblePrivileges = privileges.filter((privilege) => privilege.toUpperCase() !== "MAINTAIN");
    if (compatiblePrivileges.length === 0) return `-- PG16 disposable compatibility: stripped unsupported MAINTAIN privilege: ${line.trim()}`;
    return `${grant[1]}${compatiblePrivileges.join(",")}${grant[3]}`;
  }).join("");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.get("input");
  const output = args.get("output");
  const postgresMajor = args.get("postgres-major");
  if (!input || !output || !postgresMajor) throw new Error("input, output and postgres-major are required");
  if (!new Set(["16", "17"]).has(postgresMajor)) throw new Error("postgres-major must be 16 or 17");
  const schema = readFileSync(resolve(input), "utf8");
  const prepared = postgresMajor === "16" ? normalizeForPostgres16(schema) : schema;
  writeFileSync(resolve(output), prepared, "utf8");
  console.log(`Prepared disposable PostgreSQL ${postgresMajor} schema input.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
