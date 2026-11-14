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
  let score = 0, collided = false;
  const game = createGame(canvas,{background:image,sprites:image,music:new Blob(),sounds:{},levelText},{onScore:n=>score=n,onGameOver:()=>{collided=true}});
  game.start();
  const t = globalThis.__dockingTest;
  const reset = () => {t.reset();t.stopSpawns();collided=false;game.resume();};
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

  for (const size of [0,1,2]) {
    reset();boat=makeShip(20+size,300,250);boat.size=size;boat.cargo=[1,2,4][size];t.pushShip(boat);
    handlers.pointerdown(event(300,250));handlers.pointermove(event(490,300));
    assert.equal(boat.targetDock,t.level.docks[0],'target is accepted as the finger reaches the matching berth');
    assert.equal(boat.path.length,9,'eight curved points and the berth endpoint are added');
    assert.deepEqual(boat.path.at(-1),{x:500,y:300},'the route ends at the dock itself');
    assert.deepEqual(boat.path.at(-2),{x:500-[2,5,10][size],y:300},'the final segment aligns with the berth using the original size-specific offset');
    const before=boat.path.map(point=>({...point}));
    handlers.pointermove(event(800,500));
    assert.deepEqual(boat.path,before,'a snapped route stops following the finger until the next drag');
    handlers.pointerup(event(800,500));
    let followedFinalCurve=false;
    for(let n=0;n<600 && boat.state==='sailing';n++) {
      t.update(1/60);
      if (Math.hypot(boat.x-500,boat.y-300)<35 && boat.path.length) followedFinalCurve=true;
    }
    assert.equal(followedFinalCurve,true,'the boat follows the final curve instead of switching early to a straight approach');
  }

  reset();boat=makeShip(29,300,200);t.pushShip(boat);
  handlers.pointerdown(event(300,200));
  for(const x of [340,350,360,370,380,390,400]) handlers.pointermove(event(x,200));
  handlers.pointermove(event(490,300));
  assert.deepEqual(boat.path.slice(0,4),[{x:340,y:200},{x:350,y:200},{x:360,y:200},{x:370,y:200}], 'snapping retains the earlier route after trimming approximately 16 units from its tail');
  assert.equal(boat.path.length,13,'trimmed route is followed by eight curve points and the dock');
  handlers.pointerup(event(490,300));

  reset();boat=makeShip(30,300,300);t.pushShip(boat);
  handlers.pointerdown(event(300,300));handlers.pointermove(event(450,300));
  assert.equal(boat.targetDock,null,'40 units from the berth approach is outside the strict snap radius');
  handlers.pointermove(event(450.1,300));
  assert.equal(boat.targetDock,t.level.docks[0],'inside the 40-unit radius the route snaps');
  handlers.pointerup(event(450.1,300));

  reset();boat=makeShip(31,450,300);t.pushShip(boat);
  handlers.pointerdown(event(450,300));handlers.pointermove(event(490,300));
  assert.equal(boat.targetDock,null,'a boat already within 40 units of the approach does not snap');
  handlers.pointerup(event(490,300));

  reset();boat=makeShip(32,300,300,[],1);t.pushShip(boat);
  handlers.pointerdown(event(300,300));handlers.pointermove(event(490,300));
  assert.equal(boat.targetDock,null,'a dock for the wrong cargo cannot be targeted');
  handlers.pointerup(event(490,300));

  reset();const dock=t.level.docks[0];
  const berthed=makeShip(33,500,300);berthed.cargo=0;berthed.state='waiting';berthed.dock=dock;dock.occupant=33;t.pushShip(berthed);
  boat=makeShip(34,300,300);t.pushShip(boat);
  handlers.pointerdown(event(300,300));handlers.pointermove(event(490,300));handlers.pointerup(event(490,300));
  assert.equal(boat.targetDock,dock,'manual targeting can select an occupied, otherwise unblocked dock');
  tick(7);
  assert.equal(collided,true,'sending a boat into an occupied berth can cause a collision');
  assert.equal(score,0,'the incoming boat does not unload over the occupant');

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
