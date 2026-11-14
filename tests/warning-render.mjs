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
  const sprites={complete:true,naturalWidth:512,naturalHeight:512};
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
  for(let size=0;size<3;size++) {
    const count=[1,2,4][size];
    const unrouted=boat(10+size*2,100+size*200,400,size,count);
    unrouted.warning=true;
    if (size===1) unrouted.cargoType=1;
    const routed=boat(11+size*2,100+size*200,500,size,count);
    routed.path=[{x:900,y:68}];
    test.pushShip(unrouted);test.pushShip(routed);
  }
  draws.length=0;test.render();
  const spriteDraws=draws.filter(args=>args[0]===sprites);
  const hulls=spriteDraws.filter(args=>[32,44,70].includes(args[3]) && [16,18,22].includes(args[4]));
  assert.deepEqual(hulls.map(args=>args.slice(1,5)),[[0,0,32,16],[0,16,32,16],[32,0,44,18],[32,18,44,18],[76,0,70,22],[76,22,70,22]], 'hull colour changes with a valid route for each boat size');
  const warnings=spriteDraws.filter(args=>args[2]===64);
  assert.deepEqual(warnings.map(args=>args.slice(1)),[[0,64,37,32,-18.5,-16,37,32],[37,64,50,32,-29,-16,50,32],[87,64,75,32,-47.5,-16,75,32]], 'warning outlines use the native crops and center offsets');
  assert.ok(spriteDraws.indexOf(warnings.at(-1)) < spriteDraws.indexOf(hulls[0]), 'warnings appear underneath the boats');
  const cargo=spriteDraws.filter(args=>args[3]===16 && args[4]===16);
  assert.deepEqual(cargo.map(args=>[args[1],args[2],args[5],args[6]]),[
    [0,32,-10,-8],[0,32,-10,-8],
    [16,32,-6,-8],[16,32,-15,-8],[0,32,-6,-8],[0,32,-15,-8],
    [0,32,-8,-8],[0,32,-17,-8],[0,32,-26,-8],[0,32,-35,-8],
    [0,32,-8,-8],[0,32,-17,-8],[0,32,-26,-8],[0,32,-35,-8],
  ], 'both cargo colours use the original sprite and placement for each size');

  test.getShips().length=0;
  const partiallyUnloaded=boat(29,100,400,2,2);partiallyUnloaded.state='unloading';
  test.pushShip(partiallyUnloaded);
  draws.length=0;test.render();
  assert.deepEqual(draws.filter(args=>args[0]===sprites && args[3]===16 && args[4]===16).map(args=>args[5]),[-26,-35], 'unloading removes cargo from the front without shifting the remainder');

  test.getShips().length=0;
  const noRoute=boat(30,100,400,0,0);
  const exitRoute=boat(31,200,400,0,0);exitRoute.path=[{x:1024,y:400}];
  const waiting=boat(32,300,400,0,0);waiting.state='waiting';
  test.pushShip(noRoute);test.pushShip(exitRoute);test.pushShip(waiting);
  draws.length=0;test.render();
  assert.deepEqual(draws.filter(args=>args[0]===sprites && args[3]===32 && args[4]===16).map(args=>args[2]),[0,16,16], 'empty boats are red until routed to an exit, or grey while docked');
  game.destroy();URL.createObjectURL=objectUrl;URL.revokeObjectURL=revoke;
  console.log('PASS: warning cooldowns, native warning outlines, route-sensitive hulls and original cargo sprites');
} finally { await rm(dir,{recursive:true,force:true}); }
