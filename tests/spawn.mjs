import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'harbor-spawn-test-'));
try {
  const output = join(dir, 'spawn.cjs');
  await build({entryPoints:['src/spawn.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {chooseBoatSize, chooseSpawnCandidate} = await import(pathToFileURL(output).href);
  assert.equal(chooseBoatSize([0,0,0],[999,2,0],()=>0),0);
  assert.equal(chooseBoatSize([0,0,0],[999,2,0],()=>.5),1);
  assert.equal(chooseBoatSize([0,2,0],[999,2,0],()=>.8),0);
  assert.equal(chooseBoatSize([0,0,0],[999,2,1],()=>.999),2);
  assert.equal(chooseBoatSize([1,1,1],[1,1,1]),null);
  for (let edge=0; edge<4; edge++) {
    const values = [(edge+.1)/4,.5]; let i=0;
    const c=chooseSpawnCandidate(1024,768,0,()=>true,()=>values[i++ % values.length]);
    assert.equal(c.edge,['left','right','top','bottom'][edge]);
    assert.ok(c.start.x < 0 || c.start.x > 1024 || c.start.y < 0 || c.start.y > 768, 'boat starts outside viewport');
    assert.deepEqual(c.target, {x:512,y:384}, 'initial heading points toward center');
    assert.ok(Math.abs(Math.hypot(c.clearance.x-c.entry.x,c.clearance.y-c.entry.y)-30)<1e-9, 'checks first 30 units inward');
    assert.ok(Math.cos(c.angle) * (c.target.x-c.entry.x) + Math.sin(c.angle) * (c.target.y-c.entry.y) > 0,'heading points into screen');
  }
  let attempts=0;
  assert.equal(chooseSpawnCandidate(1024,768,0,()=>{attempts++; return false},()=>.5),null);
  assert.equal(attempts,11,'unsuitable entries are bounded');
  let seen=0;
  assert.ok(chooseSpawnCandidate(1024,768,1,()=>++seen===3,()=>.5));
  assert.equal(seen,3,'failed candidates are retried');
  console.log('PASS: uniform available-type selection; randomized four-edge entries; rejected routes retried with cap');
} finally { await rm(dir,{recursive:true,force:true}); }
