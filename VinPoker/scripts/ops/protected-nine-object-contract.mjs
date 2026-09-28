import { createHash } from "node:crypto";

const unique = (values) => [...new Set(values)].sort();
const matches = (source, pattern, index = 1) => [...source.matchAll(pattern)].map((match) => match[index].toLowerCase());
const literals = (values) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");

export function deriveObjectScope(entries) {
  const sql = entries.map((entry) => entry.sql).join("\n");
  const functionNames = unique(matches(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][\w]*\.[a-z_][\w]*)/gi));
  const triggerNames = unique(matches(sql, /CREATE\s+TRIGGER\s+([a-z_][\w]*)/gi));
  const policyNames = unique(matches(sql, /CREATE\s+POLICY\s+([a-z_][\w]*)/gi));
  const indexNames = unique(matches(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w]*)/gi));
  const constraintNames = unique(matches(sql, /ADD\s+CONSTRAINT\s+([a-z_][\w]*)/gi));
  const tableNames = unique([
    ...matches(sql, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w]*\.[a-z_][\w]*)/gi),
    ...matches(sql, /ALTER\s+TABLE\s+([a-z_][\w]*\.[a-z_][\w]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi),
    ...matches(sql, /(?:GRANT|REVOKE)[\s\S]*?\s+ON\s+TABLE\s+([a-z_][\w]*\.[a-z_][\w]*)/gi),
  ]);
  return { functionNames, triggerNames, policyNames, indexNames, constraintNames, tableNames };
}

export function scopeHash(scope) {
  return createHash("sha256").update(JSON.stringify(scope), "utf8").digest("hex");
}

export function catalogSnapshotSql(scope) {
  const functionNames = literals(scope.functionNames);
  const triggerNames = literals(scope.triggerNames);
  const policyNames = literals(scope.policyNames);
  const indexNames = literals(scope.indexNames);
  const constraintNames = literals(scope.constraintNames);
  const tableNames = literals(scope.tableNames);
  return `
WITH function_rows AS (
  SELECT n.nspname||'.'||p.proname AS name,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef AS security_definer,
         p.provolatile::text AS volatility,
         coalesce(p.proconfig, ARRAY[]::text[]) AS config,
         encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS body_sha256,
         coalesce((SELECT jsonb_agg((CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END)||':'||x.privilege_type ORDER BY 1)
                   FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'[]'::jsonb) AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname||'.'||p.proname IN (${functionNames || "NULL"})
), trigger_rows AS (
  SELECT t.tgname AS name, ns.nspname||'.'||c.relname AS relation,
         pg_get_triggerdef(t.oid,true) AS definition,
         pn.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
  JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND t.tgname IN (${triggerNames || "NULL"})
), policy_rows AS (
  SELECT pol.polname AS name, n.nspname||'.'||c.relname AS relation, pol.polpermissive AS permissive,
         pol.polcmd::text AS command,
         coalesce((SELECT jsonb_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(pol.polroles) role),'[]'::jsonb) AS roles,
         coalesce(pg_get_expr(pol.polqual,pol.polrelid),'') AS using_expression,
         coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'') AS check_expression
  FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE pol.polname IN (${policyNames || "NULL"})
), index_rows AS (
  SELECT c.relname AS name, pg_get_indexdef(c.oid) AS definition
  FROM pg_class c WHERE c.relkind='i' AND c.relname IN (${indexNames || "NULL"})
), constraint_rows AS (
  SELECT con.conname AS name, n.nspname||'.'||c.relname AS relation, pg_get_constraintdef(con.oid,true) AS definition
  FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE con.conname IN (${constraintNames || "NULL"})
), table_rows AS (
  SELECT n.nspname||'.'||c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
         coalesce((SELECT jsonb_agg((CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END)||':'||x.privilege_type ORDER BY 1)
                   FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),'[]'::jsonb) AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m') AND n.nspname||'.'||c.relname IN (${tableNames || "NULL"})
)
SELECT jsonb_build_object(
  'scope_sha256','${scopeHash(scope)}',
  'functions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,args) FROM function_rows x),'[]'::jsonb),
  'triggers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,relation) FROM trigger_rows x),'[]'::jsonb),
  'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,relation) FROM policy_rows x),'[]'::jsonb),
  'indexes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name) FROM index_rows x),'[]'::jsonb),
  'constraints',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,relation) FROM constraint_rows x),'[]'::jsonb),
  'tables',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name) FROM table_rows x),'[]'::jsonb)
)::text;
`;
}

export function compareObjectContract(actual, expected) {
  for (const section of ["scope_sha256", "functions", "triggers", "policies", "indexes", "constraints", "tables"]) {
    if (JSON.stringify(actual[section]) !== JSON.stringify(expected[section])) throw new Error(`Protected-nine object contract drift: ${section}`);
  }
}
