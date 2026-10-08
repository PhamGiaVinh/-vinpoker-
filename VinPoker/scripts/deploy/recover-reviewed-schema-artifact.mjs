import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

// Recovery of the already-sanitized, owner-reviewed TEST schema only.
// No credentials, database query, production write, or historical SQL replay here.
const expected='703aed6b620cd24f34c31d4545b2d7e97e4a488f89fe81dfc1a36b175d259223';
assert.equal(process.env.GITHUB_ACTOR,process.env.GITHUB_REPOSITORY_OWNER);
const chunks=Array.from({length:17},(_,i)=>process.env[`BASELINE_${String(i+1).padStart(2,'0')}`]??'');
assert.ok(chunks.every(chunk=>chunk.length>0 && /^[A-Za-z0-9+/=]+$/.test(chunk)),'complete private recovery input required');
const schema=gunzipSync(Buffer.from(chunks.join(''),'base64'),{maxOutputLength:5_000_000});
assert.equal(createHash('sha256').update(schema).digest('hex'),expected,'original baseline bytes must match');
const dir=join(process.env.RUNNER_TEMP,'reviewed-pre-release-schema');
mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'live-public-schema.sql'),schema,{mode:0o600});
writeFileSync(join(dir,'live-public-schema.sha256'),`${expected}  live-public-schema.sql\n`,{mode:0o600});
writeFileSync(join(process.env.RUNNER_TEMP,'reviewed-pre-release-schema.provenance.json'),JSON.stringify({originalCaptureRun:37229283609,originalCaptureSha:'d64df388d42b51cb851e8d23361d4fe568988eb7',schemaSha256:expected,schemaOnly:true,recoveryRun:process.env.GITHUB_RUN_ID})+'\n',{mode:0o600});
const result=spawnSync(process.execPath,['VinPoker/scripts/deploy/validate-live-public-schema-artifact.mjs','--artifact-directory',dir],{encoding:'utf8'});
// Never print the recovered content or inputs, including on failure.
assert.equal(result.status,0,'recovered artifact failed schema-only/secret validation');
console.log('EXACT_REVIEWED_TEST_BASELINE_RECOVERED_AND_VALIDATED');
