// Deterministic movement checks using synthetic geometry and mocked rendering.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'harbor-traversal-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker), 'simulation test hook exists');
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__movement = {update, stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1e9,spawnElapsed:-999999}}, getShips:()=>ships, pushShip:(s:any)=>ships.push(s)};\n  return {`);
  const outfile = join(temp,'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(outfile).href);
  const handlers = {};
  const context = new Proxy({}, {get:()=>()=>{},set:()=>true});
  const canvas = {style:{},getContext:()=>context,addEventListener(n,f){handlers[n]=f},removeEventListener(){},setPointerCapture(){},hasPointerCapture(){return false},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const image={complete:true,naturalWidth:1024};
  const levelText='mapSize 1024 768\ndockElement\n900 68\n0\n0\n1\n1\n0\n';
  const game=createGame(canvas,{background:image,sprites:image,music:new Blob(),sounds:{},levelText});
  game.start();
  const api=globalThis.__movement;
  api.stopSpawns();
  const ship=(id,x,y)=>({id,x,y,angle:0,cargoType:0,cargo:1,size:0,speed:40,state:'sailing',path:[],dock:null,unloadTime:0,entered:true});
  const a=ship(1,100,100); a.path=[{x:100,y:110},{x:130,y:110},{x:130,y:140}]; api.pushShip(a);
  api.update(.875); // 35 units of travel: ten vertically then 25 horizontally.
  assert.ok(Math.abs(a.x-125)<1e-8 && Math.abs(a.y-110)<1e-8,'position remains on drawn segments and consumes speed × time');
  assert.equal(a.path.length,2,'fully traversed segments are removed');
  assert.ok(a.angle > 0 && a.angle < Math.PI/2,'heading turns independently of path position');
  const b=ship(2,400,200); api.pushShip(b);
  const ev=(type,x,y)=>handlers[type]?.({pointerId:7,clientX:x,clientY:y,preventDefault(){}});
  ev('pointerdown',400,200); ev('pointermove',550,250); ev('pointerup',550,250);
  assert.equal(b.path.length,8,'a long pointer gap is sampled into eight native-style curve points');
  assert.deepEqual(b.path.at(-1),{x:550,y:250},'the curve ends at the finger location');
  game.destroy();
  console.log('PASS: path arc-length traversal, orientation and long-gap touch smoothing');
} finally { await rm(temp,{recursive:true,force:true}); }
