import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const migration = readFileSync('supabase/migrations/20270128000036_floor_manual_entry_roundtrip_v1.sql', 'utf8').replaceAll('\r', '');
const patches = [...migration.matchAll(/\('(public\.[^']+)',\s*'([a-f0-9]{32})',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\)/g)];
assert.equal(patches.length, 3);
const display = migration.match(/old_text text:='([^']+)';\s*new_text text:=\$new\$([\s\S]*?)\$new\$/);
assert.ok(display);
const inverse = `DO $restore$
DECLARE f regprocedure; b text;
BEGIN
 f:='public.get_floor_seatable_entries(uuid)'::regprocedure;
 b:=replace(pg_get_functiondef(f),chr(13),'');
 IF length(b)-length(replace(b,$new$${display[2]}$new$,''))<>length($new$${display[2]}$new$) THEN RAISE EXCEPTION 'manual_display_inverse_not_unique'; END IF;
 EXECUTE replace(b,$new$${display[2]}$new$,$old$${display[1]}$old$);
 ${patches.map(([,signature,baseline,oldText,newText]) => `
 f:='${signature}'::regprocedure;
 b:=replace(pg_get_functiondef(f),chr(13),'');
 IF length(b)-length(replace(b,$new$${newText}$new$,''))<>length($new$${newText}$new$) THEN RAISE EXCEPTION 'manual_inverse_not_unique'; END IF;
 EXECUTE replace(b,$new$${newText}$new$,$old$${oldText}$old$);
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=f)<>'${baseline}' THEN RAISE EXCEPTION 'manual_baseline_restore_drift'; END IF;
 `).join('\n')}
END $restore$;`;
const apply = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1'], {
  encoding: 'utf8', input: `BEGIN;\n${inverse}\n${apply}\nROLLBACK;`,
});
assert.equal(result.status, 0, result.stderr);
console.log('MANUAL_ENTRY_BASELINE_RESTORE_ATOMIC_REAPPLY_PASS');
