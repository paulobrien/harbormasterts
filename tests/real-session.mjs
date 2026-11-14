// End-to-end snapshot / local storage / resume against the optional HD IPA.
// No original game data is written into this repository.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
const suppliedPath=process.env.HARBOR_HD_IPA || process.argv[2];
const originalPath=suppliedPath || resolve('../upload/Harbor Master HD 2.0.1.ipa');
let levelText;
try {
  await access(originalPath);
  const files=unzipSync(new Uint8Array(await readFile(originalPath)),{filter:e=>e.name.toLowerCase().endsWith('/hmhd0001.lvl')});
  const name=Object.keys(files)[0]; assert.ok(name,'HD IPA must contain hmhd0001.lvl');
  levelText=new TextDecoder().decode(files[name]);
} catch(error) {
  if(suppliedPath || error?.code!=='ENOENT') throw error;
  levelText='mapSize 1024 768\ndockElement\n512 434\n0\n0\n1\n1\n0\n';
  console.log('NOTE: HD IPA absent; using a synthetic level. Set HARBOR_HD_IPA for the original level.');
}
const dir=await mkdtemp(join(tmpdir(),'harbor-real-session-'));
try {
  let source=await readFile('src/game.ts','utf8');
  const marker='  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker),'game test seam exists');
  source=`export {readShiftSave,writeShiftSave} from './shift-save';\n`+source;
  source=source.replace(marker,`  reset();\n  render();\n  (globalThis as any).__session = {level,update, getShips:()=>ships,pushShip:(s:any)=>ships.push(s),seed:()=>{score=2;nextId=2;elapsed=34.5;pressure={phase:0,phaseElapsed:8,spawnElapsed:12,threshold:5};activePacing={...activePacing,interval:100}}};\n  return {`);
  const outfile=join(dir,'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame,saveLevelForAssets,readShiftSave,writeShiftSave}=await import(pathToFileURL(outfile).href);
  const memory=new Map();
  const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  const canvas=()=>({style:{},getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true}),addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})});
  const img={complete:true,naturalWidth:1024},assets={background:img,sprites:img,music:new Blob(),sounds:{},levelText};
  const level=saveLevelForAssets(levelText),calls=[];
  const first=createGame(canvas(),assets,{onScore:n=>calls.push(n)});
  const a=globalThis.__session; a.seed();
  const dock=a.level.docks[0]; dock.occupant=0;
  a.pushShip({id:0,x:dock.x,y:dock.y,angle:0,speed:20,size:1,cargoType:dock.cargo,cargo:2,state:'unloading',path:[],dock,targetDock:null,unloadTime:.7,entered:true,warning:false,warningTimer:1});
  a.pushShip({id:1,x:900,y:300,angle:Math.PI,speed:40,size:0,cargoType:dock.cargo,cargo:1,state:'sailing',path:[{x:700,y:300}],dock:null,targetDock:null,unloadTime:0,entered:true,warning:false,warningTimer:1});
  const saved=first.snapshot('shift-real-roundtrip');
  assert.ok(saved,'active HD shift produces a valid snapshot');
  assert.equal(saved.score,2);assert.equal(saved.ships.length,2);
  assert.equal(saved.ships[0].dockIndex,0);assert.equal(saved.ships[0].cargo,2);
  assert.deepEqual(saved.pressure,{phase:0,phaseElapsed:8,spawnElapsed:12,threshold:5});
  assert.equal(writeShiftSave(saved,level,storage),true,'saved shift writes to browser-like storage');
  first.destroy();
  const loaded=readShiftSave(level,storage);
  assert.deepEqual(loaded,saved,'saved shift survives serialization and reload');
  const scores=[];const second=createGame(canvas(),assets,{onScore:n=>scores.push(n)});
  const b=globalThis.__session;
  assert.equal(second.restore(loaded),true,'a fresh controller restores the saved HD shift');
  assert.equal(b.level.docks[0].occupant,0,'dock occupancy is reconstructed');
  const restored=second.snapshot('shift-real-roundtrip');
  assert.deepEqual(restored.pressure,saved.pressure,'pressure phase and clocks survive reload');
  assert.deepEqual(restored.activePacing,saved.activePacing,'spawn configuration survives reload');
  assert.deepEqual(restored.ships,saved.ships,'sailing paths and unloading state survive reload');
  assert.equal(scores.at(-1),2,'score restored before play resumes');
  second.start();
  for(let n=0;n<240;n++)b.update(1/60);
  assert.equal(scores.at(-1),4,'remaining two cargo items score exactly once');
  const post=second.snapshot('shift-real-roundtrip');
  assert.equal(post.ships.find(s=>s.id===0).cargo,0,'unloading finishes');
  assert.equal(post.ships.find(s=>s.id===0).state,'waiting','boat waits in the occupied dock');
  for(let n=0;n<180;n++)b.update(1/60);
  assert.equal(scores.at(-1),4,'waiting in dock does not duplicate cargo scoring');
  second.destroy();
  console.log('PASS: HD snapshot/storage/reload, boat paths, dock occupancy, pressure, unloading and no duplicate scoring');
} finally {await rm(dir,{recursive:true,force:true});}
