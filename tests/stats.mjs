import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'harbor-stats-test-'));
try {
  const output = join(dir, 'stats.cjs');
  await build({entryPoints:['src/stats.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {readShiftStats, ShiftRecorder} = await import(pathToFileURL(output).href);
  const items = new Map();
  const storage = {getItem:k=>items.get(k)??null, setItem:(k,v)=>items.set(k,v)};
  assert.deepEqual(readShiftStats(storage), {shifts:0,totalCargo:0,best:0});
  const first = new ShiftRecorder(storage);
  assert.deepEqual(first.complete(8), {shifts:1,totalCargo:8,best:8});
  assert.deepEqual(first.complete(8), {shifts:1,totalCargo:8,best:8}, 'duplicate completion does not count twice');
  const abandoned = new ShiftRecorder(storage);
  assert.deepEqual(readShiftStats(storage), {shifts:1,totalCargo:8,best:8}, 'an incomplete shift does not count');
  assert.deepEqual(abandoned.complete(3), {shifts:2,totalCargo:11,best:8});
  assert.deepEqual(new ShiftRecorder(storage).complete(12), {shifts:3,totalCargo:23,best:12});
  // Legacy records lacked completion IDs; migration preserves totals.
  items.set('harbor-treasure-island-stats-v1', JSON.stringify({shifts:2,totalCargo:11,best:8}));
  const afterMigration = new ShiftRecorder(storage, 'saved-shift-123').complete(7);
  assert.deepEqual(afterMigration, {shifts:3,totalCargo:18,best:8}, 'legacy stats preserved when adding an id');
  assert.deepEqual(new ShiftRecorder(storage, 'saved-shift-123').complete(7), afterMigration, 'restored duplicate shift is ignored');
  assert.deepEqual(new ShiftRecorder(storage, 'saved-shift-456').complete(9), {shifts:4,totalCargo:27,best:9}, 'distinct shift still counts');
  items.set('harbor-treasure-island-stats-v1', '{not-json');
  assert.deepEqual(readShiftStats(storage), {shifts:0,totalCargo:0,best:0}, 'corrupt saved data does not break game');
  console.log('PASS: local shift totals, best score, idempotent game-over, incomplete shift and corrupt storage');
} finally { await rm(dir, {recursive:true,force:true}); }
