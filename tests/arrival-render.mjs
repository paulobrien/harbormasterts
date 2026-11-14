// Incoming-boat timing, sprites, reduced motion and saved shifts, without game assets.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'harbor-arrival-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker));
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__arrivalTest = {spawn, update, render, getShips:()=>ships, routeCount:()=>routes.size};\n  return {`);
  const output = join(dir, 'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(output).href);

  const images=[], stack=[], handlers={};
  const context = new Proxy({
    position:null,
    save(){stack.push(this.position)}, restore(){this.position=stack.pop()},
    translate(x,y){this.position={x,y}},
    drawImage(...args){images.push({args,position:this.position})},
  },{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>(target[name]=value,true)});
  const canvas={style:{},getContext:()=>context,addEventListener(name,handler){handlers[name]=handler},removeEventListener(){},
    getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768}),setPointerCapture(){},hasPointerCapture(){return false}};
  const sprites={complete:true,naturalWidth:512,naturalHeight:512};
  const assets={sprites,background:{complete:false,naturalWidth:0},music:new Blob(),sounds:{},
    levelText:'mapSize 1024 768\ndockElement\n900 700\n0\n0\n1\n1\n0\n'};
  const motion={matches:false};
  globalThis.window={matchMedia:()=>motion};
  globalThis.requestAnimationFrame=()=>1;
  globalThis.cancelAnimationFrame=()=>{};
  const random=Math.random;
  try {
    const values=[.1,.1,.5,.1];let index=0;
    Math.random=()=>values[Math.min(index++,values.length-1)];
    let crashed=false;
    const game=createGame(canvas,assets,{onGameOver:()=>{crashed=true}});
    const test=globalThis.__arrivalTest;
    assert.equal(test.spawn(),true);
    let boat=test.getShips()[0];
    assert.equal(boat.spawnElapsed,0);
    assert.ok(Math.abs(boat.x+10)<1e-9,'small boat starts ten units outside the map');
    const start={x:boat.x,y:boat.y};
    game.start();
    handlers.pointerdown({pointerId:1,clientX:0,clientY:384,preventDefault(){}});
    assert.equal(test.routeCount(),0,'an incoming boat cannot be selected while its arrow is displayed');
    test.getShips().push({...boat,id:99,spawnElapsed:undefined,speed:0});
    test.update(.01);
    assert.equal(crashed,false,'a spawning boat is excluded from collisions');
    test.getShips().pop();
    test.update(.99);
    assert.deepEqual({x:boat.x,y:boat.y},start,'the boat remains stationary during the warning');
    images.length=0;test.render();
    const arrow=images.find(({args})=>args[0]===sprites && args[1]===34 && args[2]===36);
    assert.ok(arrow,'the original incoming arrow is displayed');
    assert.deepEqual(arrow.args.slice(1),[34,36,37,27,-18.5,-13.5,37,27]);
    assert.ok(Math.abs(arrow.position.x-(start.x+30+5*Math.sin(5)))<1e-9,'arrow oscillates ahead of the boat');
    assert.equal(images.some(({args})=>args[0]===sprites && args[1]===0 && args[2]===0 && args[3]===32 && args[4]===16),false,'the hull is hidden during the warning');
    motion.matches=true;images.length=0;test.render();
    assert.equal(images.find(({args})=>args[0]===sprites && args[1]===34).position.x,start.x+30,'reduced motion keeps the arrival arrow stationary');

    const snapshot=game.snapshot('arrival-save');
    assert.equal(snapshot.ships[0].spawnElapsed,1);
    game.pause();
    assert.equal(game.restore(snapshot),true);
    assert.deepEqual(game.snapshot('arrival-save'),snapshot,'the remaining warning time survives a saved shift');
    boat=test.getShips()[0];
    test.update(1);
    assert.equal(boat.spawnElapsed,2,'warning remains active through two seconds');
    test.update(.01);
    assert.equal(boat.spawnElapsed,undefined,'warning ends after two seconds');
    assert.deepEqual({x:boat.x,y:boat.y},start,'movement starts on the following simulation step');
    images.length=0;test.render();
    assert.equal(images.some(({args})=>args[0]===sprites && args[1]===34 && args[2]===36),false,'the arrow is removed when the boat arrives');
    test.update(.5);
    assert.ok(boat.x>0 && boat.entered,'the boat then sails into the harbor');
    test.getShips().splice(0,1,...[0,1,2].map(size=>({...boat,id:size,x:100+size*100,y:384,size,angle:0,entered:false,spawnElapsed:1})));
    images.length=0;test.render();
    assert.deepEqual(images.filter(({args})=>args[0]===sprites && args[1]===34 && args[2]===36).map(({position})=>position.x),[130,235,345], 'all boat sizes use the original warning offsets');
    game.destroy();
  } finally { Math.random=random; delete globalThis.window; }
  console.log('PASS: original arrival arrow, delay, reduced motion, selection and save/restore');
} finally { await rm(dir,{recursive:true,force:true}); }
