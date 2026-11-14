// Deterministic integration smoke test of the simulation with a canvas mock.
// Run after npm install with: node tests/game-smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(join(tmpdir(), 'harbor-game-test-'));
try {
  const outfile = join(temp, 'game.cjs');
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker), 'game test seam exists');
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__smoke = {stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1e9,spawnElapsed:-999999}},pushShip:(ship:any)=>ships.push(ship),getShips:()=>ships};\n  return {`);
  await build({ stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'}, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { createGame } = await import(pathToFileURL(outfile).href);

  let queue = new Map();
  let nextFrame = 1;
  let now = 0;
  globalThis.requestAnimationFrame = callback => { const id = nextFrame++; queue.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => queue.delete(id);
  const realRandom = Math.random;
  Math.random = () => 0.1; // left entry, first lane and first cargo type

  const level = (dockX, dockScreenY, interval = 1000) => `mapSize 1024 768\npacingElement\n0 9999\n${interval} 1 0 999 0 0 0 0 0\ndockElement\n${dockX} ${768 - dockScreenY}\n0\n0\n1\n1\n0\ndockElement\n900 600\n0\n0\n1\n1\n1\n`;
  function fakeCanvas() {
    const handlers = new Map();
    const coordinates = [];
    const gradient = {};
    const ctx = new Proxy({
      clearRect() { coordinates.length = 0; },
      translate(x, y) { coordinates.push({ x, y }); },
      createLinearGradient() { return gradient; },
    }, {
      get(target, name) { return name in target ? target[name] : () => {}; },
      set(target, name, value) { target[name] = value; return true; },
    });
    return {
      coordinates,
      width: 0, height: 0, style: {},
      getContext() { return ctx; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1024, height: 768 }; },
      addEventListener(name, fn) { handlers.set(name, fn); },
      removeEventListener(name) { handlers.delete(name); },
      setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {},
      pointer(type, x, y) { handlers.get(type)?.({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} }); },
    };
  }
  const image = { complete: true, naturalWidth: 1024 };
  const assets = text => ({ background: image, sprites: image, music: new Blob(), sounds: {}, levelText: text });
  function tick(seconds) {
    const steps = Math.ceil(seconds / .05);
    for (let i = 0; i < steps; i++) {
      now += 50;
      const current = [...queue.values()];
      queue = new Map();
      current.forEach(callback => callback(now));
    }
  }
  function route(canvas, from, to) {
    canvas.pointer('pointerdown', from.x, from.y);
    const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 15);
    for (let i = 1; i <= n; i++) {
      canvas.pointer('pointermove', from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n);
    }
    canvas.pointer('pointerup', to.x, to.y);
  }

  // Deliver the first ship to a dock and route the empty boat out of the harbor.
  let score = -1;
  let gameOver = false;
  let statuses = [];
  const canvas = fakeCanvas();
  const game = createGame(canvas, assets(level(250, 207.36)), {
    onScore: value => { score = value; },
    onGameOver: () => { gameOver = true; },
    onStatus: text => statuses.push(text),
  });
  assert.equal(score, 0, 'new game starts at zero');
  game.start();
  tick(5); // The original shows a two-second incoming-boat warning first.
  assert.ok(canvas.coordinates.length > 0, 'a boat spawns');
  const first = globalThis.__smoke.getShips()[0];
  assert.equal(first.spawnElapsed,undefined,'first boat has finished its incoming warning');
  assert.ok(first.x > 0 && first.x < 100, 'first boat enters from the left');
  route(canvas, first, { x: 250, y: 207.36 });
  Math.random = () => 0.9;
  tick(9.5);
  assert.equal(score, 1, 'matching dock unloads cargo and increments score');
  assert.ok(statuses.some(s => s.includes('Cargo delivered')), 'delivery confirmation emitted');
  assert.equal(gameOver, false, 'delivery does not crash');
  // The first ship is waiting at the dock and must be directed off-screen.
  // Subsequent boats enter on a different lane to keep the departure path clear.
  Math.random = () => 0.9;
  route(canvas, { x: 250, y: 207.36 }, { x: 1060, y: 207.36 });
  tick(8);
  assert.ok(canvas.coordinates.some(p => p.x > 400), 'empty boat follows its departure route');
  tick(16);
  assert.equal(gameOver, false, 'ships stay apart during departure');
  assert.ok(!canvas.coordinates.some(p => p.x > 990 && Math.abs(p.y - 207.36) < 30), 'routed boat has left the map');
  game.pause();
  const beforePause = canvas.coordinates.map(p => ({ ...p }));
  tick(2);
  assert.deepEqual(canvas.coordinates, beforePause, 'pause stops animation');
  game.restart();
  assert.equal(score, 0, 'restart resets score');
  game.destroy();

  // Two ships sailing head-on trigger an actual hull collision and game over.
  queue.clear(); now = 0; Math.random = () => 0.1;
  const collisionCanvas = fakeCanvas();
  let collision = false;
  const collisionGame = createGame(collisionCanvas, assets(level(800, 550, 5)), {
    onGameOver: () => { collision = true; },
  });
  collisionGame.start();
  const smoke = globalThis.__smoke;
  smoke.stopSpawns();
  const ship = (id, x, angle) => ({id,x,y:300,angle,cargoType:0,cargo:1,size:0,speed:40,state:'sailing',path:[],dock:null,unloadTime:0,entered:true});
  smoke.pushShip(ship(10, 400, 0));
  smoke.pushShip(ship(11, 500, Math.PI));
  tick(2);
  assert.equal(collision, true, 'opposing ships trigger a collision');
  collisionGame.destroy();
  Math.random = realRandom;
  console.log('PASS: spawn, touch routing, docking, score, departure, pause, restart and collisions');
} finally {
  await rm(temp, { recursive: true, force: true });
}
