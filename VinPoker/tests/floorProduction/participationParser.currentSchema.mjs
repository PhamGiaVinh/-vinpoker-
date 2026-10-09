import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

if (!['127.0.0.1', 'localhost'].includes(process.env.PGHOST)
  || !process.env.PGDATABASE?.startsWith('vinpoker_')) {
  throw new Error('Participation fixture requires an isolated local database');
}
const fixture = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'CLOSED_SESSION_READ_CASE=1',
  '-f', 'tests/floorProduction/trackerRosterSession.pg17.sql'], {
  encoding: 'utf8', env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ''} -c test.null_alias_anomaly=true` },
});
if (fixture.status !== 0 || !fixture.stdout.includes('ROLLBACK')) throw new Error('Public projection rollback fixture failed');
const marker = 'NULL_ALIAS_PUBLIC_PROJECTION=';
const line = fixture.stderr.split('\n').find((s) => s.includes(marker));
if (!line) throw new Error('Authenticated public projection evidence missing');
const projection = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
const compiled = ts.transpileModule(readFileSync('src/lib/tournamentParticipation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function('exports', 'module', compiled)(module.exports, module);
const parsed = module.exports.parseTournamentParticipation(projection, projection.tournament_id);
if (!parsed.seats.some((s) => s.table_id === null && s.participation_status === 'anomaly')
  || parsed.seats.some((s) => s.table_id === null && s.participation_status === 'seated')) {
  throw new Error('Invalid occupancy hidden or made actionable');
}
console.log('AUTHENTICATED_PUBLIC_PROJECTION_PARSER_PASS');
