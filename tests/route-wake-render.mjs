// Synthetic checks for the route and wake appearance; no original game files.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'harbor-route-render-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker));
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__renderTest = {update, render, pushShip:(s:any)=>ships.push(s)};\n  return {`);
  const output = join(dir, 'game.cjs');
  await build({stdin:{contents:source, sourcefile:'game.ts', resolveDir:resolve('src'), loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const { createGame } = await import(pathToFileURL(output).href);

  const strokes = [], images = [], stack = [];
  const context = {
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', dash: [],
    save() { stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,strokeStyle:this.strokeStyle,dash:[...this.dash]}); },
    restore() { Object.assign(this, stack.pop()); },
    setLineDash(dash) { this.dash = [...dash]; },
    stroke() { strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:[...this.dash]}); },
    drawImage(...args) { images.push({args,alpha:this.globalAlpha}); },
    beginPath() {}, moveTo() {}, lineTo() {}, clearRect() {}, fillRect() {},
    translate() {}, rotate() {}, ellipse() {}, fill() {}, strokeRect() {}, arc() {}, fillText() {},
  };
  const events = {};
  const canvas = {style:{},getContext:()=>context,addEventListener(name,handler){events[name]=handler},removeEventListener(){},
    getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768}),setPointerCapture(){},hasPointerCapture(){return true},releasePointerCapture(){}};
  const sprites = {complete:true,naturalWidth:512,naturalHeight:512};
  const assets = {background:{complete:false,naturalWidth:0},sprites,music:new Blob(),sounds:{},
    levelText:'mapSize 1024 768\ndockElement\n900 700\n0\n0\n1\n1\n0\ndockElement\n600 700\n0\n0\n1\n1\n1\n'};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const game = createGame(canvas, assets);
  const test = globalThis.__renderTest;
  const boat = {id:1,x:100,y:100,angle:0,speed:40,size:0,cargoType:0,cargo:1,state:'sailing',
    path:[{x:900,y:68}],dock:null,unloadTime:0,entered:true};
  test.pushShip(boat);

  strokes.length = 0;
  test.render();
  assert.deepEqual(strokes, [{color:'rgba(166, 196, 227, .4)',width:4,dash:[]}], 'a valid route is one continuous translucent line');
  boat.path = [{x:300,y:100}];
  strokes.length = 0;
  test.render();
  assert.deepEqual(strokes, [{color:'rgb(217, 85, 77)',width:3,dash:[]}], 'an unfinished route is one continuous red line');

  boat.path = [];
  test.update(.16);
  images.length = 0;
  test.render();
  const foam = () => images.filter(({args}) => args[0] === sprites && args[1] === 146 && args[2] === 22 && args[3] === 29 && args[4] === 22);
  assert.equal(foam().length, 1, 'a moving small boat leaves a wake sprite');
  const originalAlpha = foam()[0].alpha;
  assert.ok(originalAlpha > .9 && originalAlpha <= 1);
  test.update(.1);
  images.length = 0;
  test.render();
  assert.equal(foam().length, 1);
  assert.ok(foam()[0].alpha < originalAlpha, 'existing wake fades with time');

  boat.speed = 0;
  test.update(.2);
  images.length = 0;
  test.render();
  assert.equal(foam().length, 1, 'a stationary boat does not create new wake');
  game.restart();
  images.length = 0;
  test.render();
  assert.equal(foam().length, 0, 'a new shift clears the previous wake');

  boat.x = 100; boat.y = 100; boat.speed = 40; boat.path = [];
  test.pushShip(boat);
  const pointer = (x,y) => ({pointerId:7,clientX:x,clientY:y,preventDefault(){}});
  const flashes = () => images.filter(({args}) => args[0] === sprites && args[1] === 0 && args[2] === 96 && args[3] === 32 && args[4] === 32);
  events.pointerdown(pointer(100,100));
  images.length = 0;
  test.render();
  assert.equal(flashes().length, 1, 'starting a touch produces the original feedback flash');
  assert.equal(flashes()[0].alpha, .75);
  assert.deepEqual(flashes()[0].args.slice(5), [52,52,96,96], 'the flash starts centred on the touch at triple size');
  events.pointermove(pointer(590,68));
  images.length = 0;
  test.render();
  assert.deepEqual(flashes()[0].args.slice(5), [52,52,96,96], 'a non-matching dock does not trigger a target flash');
  events.pointermove(pointer(890,68));
  images.length = 0;
  test.render();
  assert.deepEqual(flashes()[0].args.slice(5), [852,20,96,96], 'a matching dock receives a centred flash');
  test.update(.1);
  images.length = 0;
  test.render();
  assert.ok(Math.abs(flashes()[0].alpha - .55) < 1e-9, 'the dock flash fades');
  assert.ok(Math.abs(flashes()[0].args[7] - 89.6) < 1e-9, 'the dock flash shrinks');
  test.update(.3);
  images.length = 0;
  test.render();
  assert.equal(flashes().length, 0, 'the dock flash disappears after 0.375 seconds');
  game.destroy();
  console.log('PASS: continuous routes, fading boat wakes, and touch and dock feedback flashes');
} finally {
  await rm(dir, {recursive:true,force:true});
}
