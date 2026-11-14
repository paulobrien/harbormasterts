// Regression checks with entirely synthetic level geometry (no original assets).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'harbor-physics-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker), 'test injection point exists');
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__physics = {level, update, reset, insidePolygon, stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1e9,spawnElapsed:-999999}}, getShips:()=>ships, pushShip:(s:any)=>ships.push(s)};\n  return {`);
  const outfile = join(dir, 'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(outfile).href);
  const handlers = {};
  const context = new Proxy({}, {get:()=>()=>{},set:()=>true});
  const canvas = {style:{},getContext:()=>context,addEventListener(n,f){handlers[n]=f},removeEventListener(){},setPointerCapture(){},hasPointerCapture(){return false},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const image = {complete:true,naturalWidth:1024};
  // A square island from x=512..612, y=284..384 and a dock on its left.
  const levelText = 'mapSize 1024 768\nlandElement\n4\n0 100\n100 100\n100 0\n0 0\ndockElement\n512 434\n0\n0\n1\n1\n0\n';
  let score = 0, crashed = false;
  const game = createGame(canvas,{background:image,sprites:image,music:new Blob(),sounds:{},levelText}, {onScore:n=>score=n,onGameOver:()=>crashed=true});
  game.start(); const t = globalThis.__physics;
  const reset = () => {t.reset();t.stopSpawns();crashed=false;};
  const ship = (id,x,y,angle=0) => ({id,x,y,angle,cargoType:0,cargo:1,size:0,speed:40,state:'sailing',path:[],dock:null,unloadTime:0,entered:true});
  const event = (id,x,y) => ({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
  const tick = seconds => {for(let i=0;i<Math.ceil(seconds*60);i++) t.update(1/60);};
  reset(); const bouncer = ship(1,450,300); t.pushShip(bouncer); tick(3);
  assert.equal(crashed,false,'shore contact does not end the game');
  assert.ok(bouncer.x < 510 && Math.cos(bouncer.angle) < 0,'boat reflects away from shore');
  assert.equal(t.level.land.some(p=>t.insidePolygon(bouncer,p)),false,'boat remains outside island');
  reset(); const clipped = ship(2,450,320); t.pushShip(clipped);
  handlers.pointerdown(event(1,450,320));handlers.pointermove(event(1,700,320));handlers.pointerup(event(1,700,320));
  assert.ok(clipped.path.length && clipped.path.at(-1).x <= 512.01,'drawn route stops at first shoreline');
  for(const [x,y,angle,component] of [[2,200,Math.PI,'left'],[1022,200,0,'right'],[200,2,-Math.PI/2,'top'],[200,766,Math.PI/2,'bottom']]) {
    reset(); const s=ship(3,x,y,angle); t.pushShip(s);tick(.1);
    assert.ok(t.getShips().includes(s),`loaded ship stays in play at ${component} edge`);
    assert.ok(s.x>=0&&s.x<=1024&&s.y>=0&&s.y<=768,`loaded ship reflects at ${component} edge`);
  }
  reset(); const a=ship(4,150,200), b=ship(5,750,200);t.pushShip(a);t.pushShip(b);
  handlers.pointerdown(event(11,150,200));handlers.pointerdown(event(12,750,200));
  handlers.pointermove(event(11,250,200));handlers.pointermove(event(12,850,200));
  handlers.pointerup(event(11,300,200));handlers.pointerup(event(12,900,200));
  assert.ok(a.path.length && b.path.length,'two simultaneous touch routes remain independent');
  reset(); const docking=ship(6,450,334);t.pushShip(docking);tick(5);
  assert.equal(docking.state,'waiting','matching dock next to shore unloads successfully');
  assert.equal(score,1,'cargo scores');
  handlers.pointerdown(event(20,docking.x,docking.y));handlers.pointermove(event(20,410,334));handlers.pointerup(event(20,410,334));tick(1);
  assert.ok(docking.x < 500 && !crashed,'boat exits dock into open water');
  reset();
  // A valid-colored berth that is already occupied must not become a target.
  const occupied = t.level.docks[0]; occupied.occupant = 999;
  const arriving = ship(7,450,334); t.pushShip(arriving);
  handlers.pointerdown(event(21,450,334));handlers.pointermove(event(21,492,334));handlers.pointerup(event(21,492,334));
  assert.equal(arriving.targetDock, null, 'occupied berth is not selected as a route target');
  game.destroy();
  console.log('PASS: land reflection, route clipping, four edge reflections, multitouch, shoreline dock and departure');
} finally { await rm(dir,{recursive:true,force:true}); }
