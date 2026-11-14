// Multi-colour spawning, unloading, routing and persistence using synthetic assets.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'harbor-mixed-cargo-'));
try {
  let source=await readFile('src/game.ts','utf8');
  const marker='  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker));
  source=source.replace(marker,`  reset();\n  render();\n  (globalThis as any).__mixed = {level,update,render,reset,spawn,getShips:()=>ships,getPacing:()=>activePacing,stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1000,spawnElapsed:0};activePacing={...activePacing,interval:9999}},push:(s:any)=>{ships.push(s);nextId=Math.max(nextId,s.id+1)},finishRest:(n:number)=>{score=n;pressure={phase:3,phaseElapsed:2,spawnElapsed:0,threshold:.3}}};\n  return {`);
  const output=join(dir,'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame}=await import(pathToFileURL(output).href);
  const draws=[],handlers={};
  const ctx=new Proxy({drawImage(...args){draws.push(args)}},{get:(target,name)=>name in target?target[name]:()=>{},set:()=>true});
  const canvas={style:{},getContext:()=>ctx,addEventListener(n,f){handlers[n]=f},removeEventListener(){},setPointerCapture(){},hasPointerCapture(){return false},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  const sprites={complete:true,naturalWidth:512,naturalHeight:512};
  const levelText='mapSize 1024 768\nmaxSmallBoats 999\nmaxMediumBoats 2\nmaxLargeBoats 1\ncargoTypes 2\nallowMultiCargoBoats 0\npacingElement\n0 16\n4 2 0 999 2 1 0 0 0\npacingElement\n16 9999\n4 2 1 999 2 1 0 0 0\ndockElement\n500 468\n0\n0\n1\n1\n0\ndockElement\n800 468\n0\n0\n1\n1\n1\n';
  let score=0;const statuses=[];
  const game=createGame(canvas,{sprites,background:{complete:false,naturalWidth:0},music:new Blob(),sounds:{},levelText},{onScore:n=>score=n,onStatus:s=>statuses.push(s)});
  game.start();game.setAutoDock(false);const t=globalThis.__mixed;
  const reset=()=>{t.reset();t.stopSpawns();};
  const ev=(name,x,y)=>handlers[name]?.({pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  const random=Math.random;
  const randomSequence=values=>{let index=0;Math.random=()=>values[Math.min(index++,values.length-1)]};
  try {
    reset();randomSequence([.95,.1,.5,.1]);
    assert.equal(t.spawn(),true);
    assert.equal(t.getShips()[0].cargoType,0);
    assert.equal(t.getShips()[0].cargoSlots,undefined,'initial boats carry a single cargo colour');

    reset();t.finishRest(16);t.update(.01);
    assert.equal(t.getPacing().allowMultiCargo,true,'the score-16 pacing stage enables mixed cargo after a rest');
    randomSequence([.95,.1,.5,.1,.1,.9,.1,.9]);
    assert.equal(t.spawn(),true);
    assert.deepEqual(t.getShips()[0].cargoSlots,[0,1,0,1],'each slot is selected independently once mixed cargo is enabled');

    // Older saves do not have the new pacing fields; derive them from their
    // saved stage so resuming an existing shift retains its difficulty.
    const legacy=game.snapshot('legacy-stage');
    delete legacy.activePacing.cargoTypes;delete legacy.activePacing.allowMultiCargo;legacy.ships=[];
    game.pause();assert.equal(game.restore(legacy),true);game.resume();
    randomSequence([.95,.1,.5,.1,.1,.9,.1,.9]);
    assert.equal(t.spawn(),true);
    assert.deepEqual(t.getShips()[0].cargoSlots,[0,1,0,1],'legacy saved pacing stages still enable mixed cargo');

    reset();
    let boat={id:0,x:300,y:300,angle:0,speed:40,size:2,cargoType:0,cargo:4,cargoSlots:[0,1,0,1],state:'sailing',path:[],dock:null,targetDock:null,unloadTime:0,entered:true};
    t.push(boat);draws.length=0;t.render();
    const cargoDraws=()=>draws.filter(args=>args[0]===sprites&&args[3]===16&&args[4]===16).map(args=>[args[1],args[5]]);
    assert.deepEqual(cargoDraws(),[[0,-8],[16,-17],[0,-26],[16,-35]],'each cargo colour uses its own original slot and sprite');
    ev('pointerdown',300,300);ev('pointermove',800,300);
    assert.equal(boat.targetDock,t.level.docks[1],'any cargo colour on the boat can select its matching dock');
    const underway=game.snapshot('mixed-underway');
    assert.deepEqual(underway.ships[0].cargoSlots,[0,1,0,1],'a route for a non-primary cargo colour can be saved');
    ev('pointerup',800,300);
    for(let n=0;n<1000 && boat.state!=='waiting';n++)t.update(.05);
    assert.equal(boat.state,'waiting');assert.equal(boat.cargo,2);assert.equal(score,2);
    assert.deepEqual(boat.cargoSlots,[0,null,0,null],'only matching cargo unloads, without shifting the rest');
    assert.ok(statuses.at(-1).includes('remaining cargo'));
    assert.equal(t.level.docks[1].occupant,0,'the partly unloaded boat remains at its dock');

    const saved=game.snapshot('mixed-partial');
    assert.ok(saved,'a docked boat with remaining non-matching cargo is a valid saved shift');
    game.pause();assert.equal(game.restore(saved),true);game.resume();boat=t.getShips()[0];
    assert.deepEqual(game.snapshot('mixed-partial'),saved,'partial cargo, its slots and dock occupancy survive restore');
    draws.length=0;t.render();assert.deepEqual(cargoDraws(),[[0,-8],[0,-26]],'remaining containers keep their positions after restore');
    ev('pointerdown',800,300);ev('pointermove',500,300);
    assert.equal(boat.targetDock,t.level.docks[0],'remaining cargo can snap directly to a second dock');
    assert.equal(t.level.docks[1].occupant,null,'the first berth is released as the new route is drawn');
    ev('pointerup',500,300);
    for(let n=0;n<1000 && boat.state!=='waiting';n++)t.update(.05);
    assert.equal(boat.state,'waiting');assert.equal(boat.cargo,0);assert.equal(score,4);
    assert.deepEqual(boat.cargoSlots,[null,null,null,null]);
    game.destroy();
  } finally {Math.random=random;}
  console.log('PASS: mixed-cargo pacing, sprite slots, two-dock deliveries and saved-shift compatibility');
} finally {await rm(dir,{recursive:true,force:true});}
