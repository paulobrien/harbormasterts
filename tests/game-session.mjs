// Snapshot/restore integration with synthetic assets and a mocked canvas.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'harbor-session-test-'));
try {
  const outfile = join(dir, 'game.cjs');
  await build({entryPoints:['src/game.ts'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame, saveLevelForAssets} = await import(pathToFileURL(outfile).href);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const context = new Proxy({}, {get:()=>()=>{},set:()=>true});
  function canvas() {return {style:{},getContext:()=>context,addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};}
  const image = {complete:true,naturalWidth:1024};
  const levelText = 'mapSize 1024 768\ndockElement\n100 100\n0\n0\n1\n1\n0\ndockElement\n200 200\n0\n0\n1\n1\n1\n';
  const assets = {background:image,sprites:image,music:new Blob(),sounds:{},levelText};
  let score = -1;
  const game = createGame(canvas(),assets,{onScore:n=>score=n});
  const initial = game.snapshot('saved-shift-id');
  assert.ok(initial,'empty but active shift snapshots successfully');
  const ship = {id:0,x:100,y:100,angle:0,speed:40,size:0,cargoType:0,cargo:1,state:'sailing',path:[{x:300,y:300}],dockIndex:null,targetDockIndex:0,unloadTime:0,entered:true,warning:true,warningTimer:1.25};
  const unloading = {...ship,id:1,x:100,y:668,state:'unloading',path:[],dockIndex:0,targetDockIndex:null,unloadTime:.75,warning:false,warningTimer:0};
  const waiting = {...ship,id:2,x:200,y:568,cargoType:1,cargo:0,state:'waiting',path:[],dockIndex:1,targetDockIndex:null,unloadTime:0,warning:false,warningTimer:0};
  const snapshot = {...initial,score:11,nextId:3,elapsed:30,pressure:{phase:2,phaseElapsed:4,spawnElapsed:6,threshold:.4},activePacing:{from:0,interval:4,maxSmall:999,maxMedium:2,maxLarge:1},ships:[ship,unloading,waiting]};
  assert.equal(game.restore(snapshot),true,'valid state restores before game starts');
  assert.equal(score,11,'score callback reflects restored score');
  assert.deepEqual(game.snapshot('saved-shift-id'),snapshot,'ships, references, path, warnings, timers and pressure round-trip');
  const other = {...snapshot,levelFingerprint:'another-map'};
  assert.equal(game.restore(other),false,'wrong map is refused');
  assert.deepEqual(game.snapshot('saved-shift-id'),snapshot,'failed restore leaves current simulation unchanged');
  game.start();
  assert.equal(game.restore(snapshot),false,'restore cannot replace a running game');
  game.pause();
  assert.equal(game.restore(snapshot),true,'paused controller can restore');
  game.destroy();
  assert.equal(game.snapshot('saved-shift-id'),null,'destroyed controllers cannot save');
  assert.ok(saveLevelForAssets(levelText).fingerprint,'asset level has a stable identity');
  console.log('PASS: simulation snapshot/restore, docks, routes, pressure, warnings and compatibility');
} finally {await rm(dir,{recursive:true,force:true});}
