// Synthetic regression tests for warning cooldowns and HD atlas coordinates.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'harbor-warning-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker));
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__warnTest = {update, render, getShips:()=>ships, pushShip:(s:any)=>ships.push(s)};\n  return {`);
  const output = join(dir, 'game.cjs');
  await build({stdin:{contents:source, sourcefile:'game.ts', resolveDir:resolve('src'), loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(output).href);
  const plays=[];
  const objectUrl = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => blob.testName || 'blob:test';
  URL.revokeObjectURL = () => {};
  globalThis.Audio = class {
    constructor(url){this.url=url;this.preload='';}
    cloneNode(){const url=this.url;return {volume:0,play(){plays.push(url);return Promise.resolve()}};}
    pause(){} removeAttribute(){}
  };
  globalThis.requestAnimationFrame=()=>1;
  globalThis.cancelAnimationFrame=()=>{};
  const draws=[];
  const context = new Proxy({drawImage(...args){draws.push(args)}},{get:(target,name)=>name in target ? target[name] : ()=>{},set:()=>true});
  const canvas={style:{},getContext:()=>context,addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768}),setPointerCapture(){},hasPointerCapture(){return false}};
  const background={complete:true,naturalWidth:1024};
  const sprites={complete:true,naturalWidth:512};
  const blob=(name)=>{const b=new Blob();b.testName=name;return b;};
  const assets={background,sprites,music:new Blob(),sounds:{warningSmall:blob('small'),warningLarge:blob('large')},levelText:'mapSize 1024 768\ndockElement\n900 700\n0\n0\n1\n1\n0\n'};
  const game=createGame(canvas,assets,{});
  const test=globalThis.__warnTest;
  const boat=(id,x,y,size,cargo=1)=>({id,x,y,angle:0,cargoType:0,cargo,size,speed:0,state:'sailing',path:[],dock:null,unloadTime:0,entered:true,warningTimer:0});
  const small=boat(1,200,200,0), large=boat(2,200,250,2,4);
  small.warningTimer=4;
  test.pushShip(small);test.pushShip(large);
  test.update(.01);
  assert.equal(small.warning,true);assert.equal(large.warning,true);
  assert.deepEqual(plays,['small'],'only the small boat has reached its individual 4 second timer');
  small.warningTimer=0;large.warningTimer=4;
  test.update(.01);
  assert.deepEqual(plays,['small','large'],'large ship uses its own cooldown and large warning horn');
  large.x=800; test.update(.01);
  assert.equal(small.warning,false);assert.equal(large.warning,false);
  test.getShips().length=0;
  for(let size=0;size<3;size++) for(const loaded of [true,false]) test.pushShip(boat(10+size*2+Number(!loaded),100+size*200,400+Number(!loaded)*100,size,loaded?1:0));
  draws.length=0;test.render();
  const rectangles=draws.filter(args=>args[0]===sprites).map(args=>args.slice(1,5));
  assert.deepEqual(rectangles,[[0,0,32,16],[0,16,32,16],[32,0,44,18],[32,18,44,18],[76,0,70,22],[76,22,70,22]]);
  game.destroy();URL.createObjectURL=objectUrl;URL.revokeObjectURL=revoke;
  console.log('PASS: per-boat warning state and cooldown, type-specific horns, all six native hull atlas rectangles');
} finally { await rm(dir,{recursive:true,force:true}); }
