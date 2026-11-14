import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'harbor-curves-test-'));
try {
  const outfile = join(temp, 'curves.cjs');
  await build({entryPoints:['src/curves.ts'], outfile, bundle:true, platform:'node', format:'cjs', logLevel:'silent'});
  const { cubicBezier, sampleNativeCurve, nativeTouchSegment } = await import(pathToFileURL(outfile).href);
  const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} differs from ${b}`);
  const p = (x,y) => ({x,y});
  assert.deepEqual(cubicBezier(p(0,0),p(0,10),p(10,10),p(10,0),0),p(0,0));
  assert.deepEqual(cubicBezier(p(0,0),p(0,10),p(10,10),p(10,0),1),p(10,0));
  const midpoint = cubicBezier(p(0,0),p(0,10),p(10,10),p(10,0),0.5);
  close(midpoint.x,5); close(midpoint.y,7.5);
  const samples = sampleNativeCurve(p(0,0),p(0,1),p(100,0),p(0,-1));
  assert.equal(samples.length,8);
  assert.deepEqual(samples.at(-1),p(100,0));
  close(samples[3].x,50); close(samples[3].y,0.75);
  assert.deepEqual(nativeTouchSegment(p(0,0),p(9,0),p(1,0),p(1,0)),[]);
  assert.deepEqual(nativeTouchSegment(p(0,0),p(9.1,0),p(1,0),p(1,0)),[p(9.1,0)]);
  assert.equal(nativeTouchSegment(p(0,0),p(99.9,0),p(1,0),p(1,0)).length,1);
  assert.equal(nativeTouchSegment(p(0,0),p(100,0),p(1,0),p(1,0)).length,8);
  assert.throws(() => sampleNativeCurve(p(0,0),p(1,0),p(10,0),p(1,0),0),RangeError);
  console.log('PASS: cubic curve coefficients, endpoints, sampling and native touch thresholds');
} finally { await rm(temp,{recursive:true,force:true}); }
