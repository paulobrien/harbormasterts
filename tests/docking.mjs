// Docking regression tests with synthetic level data; run: node tests/docking.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'harbor-docking-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker));
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__dockingTest = { level, update, reset, stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1e9,spawnElapsed:-999999}}, getShips:()=>ships, pushShip:(s:any)=>ships.push(s) };\n  return {`);
  const outfile = join(dir, 'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(outfile).href);
  const handlers = {};
  const ctx = new Proxy({}, {get:()=>()=>{}, set:()=>true});
  const canvas = {style:{}, getContext:()=>ctx, addEventListener(n,f){handlers[n]=f}, removeEventListener(){}, setPointerCapture(){}, hasPointerCapture(){return false}, getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const image = {complete:true,naturalWidth:1024};
  // A single east-facing dock at (500,300), carrying type 0 cargo.
  const levelText = 'mapSize 1024 768\ndockElement\n500 468\n0\n0\n1\n1\n0\n';
  let score = 0;
  const game = createGame(canvas,{background:image,sprites:image,music:new Blob(),sounds:{},levelText},{onScore:n=>score=n});
  game.start();
  const t = globalThis.__dockingTest;
  const reset = () => {t.reset();t.stopSpawns();};
  const makeShip = (id,x,y,route=[], cargoType=0) => ({id,x,y,angle:0,cargoType,cargo:1,size:0,speed:40,state:'sailing',path:route,dock:null,unloadTime:0,entered:true});
  const event = (x,y,id=1) => ({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
  const tick = secs => {for(let i=0;i<Math.ceil(secs*60);i++) t.update(1/60);};

  reset();
  let boat = makeShip(1,470,300,[{x:900,y:300}]);
  t.pushShip(boat);tick(.2);
  assert.equal(boat.state,'sailing','boat with unrelated active route does not auto-dock when passing a berth');
  assert.ok(boat.path.length,'unrelated route remains active');

  reset();boat = makeShip(2,470,300);t.pushShip(boat);tick(.2);
  assert.equal(boat.state,'docking','loaded ship without route auto-docks near matching available berth');
  assert.equal(t.level.docks[0].occupant,null,'approaching ship has not occupied dock yet');
  tick(1);
  assert.equal(boat.state,'unloading');
  assert.equal(t.level.docks[0].occupant,2,'dock becomes occupied at arrival');
  tick(2.1);
  assert.equal(score,1,'one cargo scores after two seconds at normal speed');

  reset();boat = makeShip(3,470,300,[{x:900,y:300}]);t.pushShip(boat);
  handlers.pointerdown(event(470,300));
  assert.equal(boat.path.length,0,'touch immediately clears the previous route');
  tick(.2);
  assert.equal(boat.state,'sailing','ship does not auto-dock while user is drawing');
  handlers.pointerup(event(700,300));

  reset();boat = makeShip(4,300,300);t.pushShip(boat);
  handlers.pointerdown(event(300,300));handlers.pointermove(event(480,300));handlers.pointerup(event(480,300));
  assert.equal(boat.targetDock,t.level.docks[0],'dragging near a matching dock targets it');
  assert.ok(boat.path.length,'approach route is retained');
  tick(7.5);
  assert.equal(boat.state,'waiting','ship reaches targeted dock and unloads');
  assert.equal(score,1);

  reset();boat = makeShip(5,470,300,[],1);t.pushShip(boat);tick(.2);
  assert.equal(boat.state,'sailing','ship does not auto-dock at wrong cargo color');
  reset();boat = makeShip(6,470,300);t.level.docks[0].occupant=99;t.pushShip(boat);tick(.2);
  assert.equal(boat.state,'sailing','ship does not auto-dock at an occupied dock');

  reset(); game.setAutoDock(false); boat = makeShip(8,470,300); t.pushShip(boat); tick(.2);
  assert.equal(boat.state,'sailing','disabling auto-docking leaves an idle nearby ship underway');
  reset(); boat = makeShip(9,300,300); t.pushShip(boat);
  handlers.pointerdown(event(300,300)); handlers.pointermove(event(480,300)); handlers.pointerup(event(480,300));
  tick(7.5);
  assert.equal(boat.state,'waiting','an explicit route still docks when automatic docking is disabled');
  assert.equal(score,1,'explicit docking still unloads and scores with automatic docking disabled');
  game.setAutoDock(true);

  reset();boat = makeShip(7,300,300,[{x:900,y:300}]);t.pushShip(boat);
  handlers.pointerdown(event(347,300));
  assert.equal(boat.path.length,0,'touch within 48-unit original selection radius selects boat');
  handlers.pointerup(event(347,300));
  game.destroy();
  console.log('PASS: intentional routes, auto-docking conditions, occupancy timing, cargo scoring, and original touch radius');
} finally {await rm(dir,{recursive:true,force:true});}
