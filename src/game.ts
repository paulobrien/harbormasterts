import type { GameAssets } from './importer';
import { nativeTouchSegment } from './curves';
import { chooseBoatSize, chooseSpawnCandidate } from './spawn';
import { advancePressure, initialPressure, parsePressureConfig, recordSuccessfulSpawn } from './stress';
import { fingerprintLevel, isValidShiftSave, type SaveLevel, type ShiftSave } from './shift-save';

/** A deliberately independent simulation: all original level data comes from the player's IPA. */
type Point = { x: number; y: number };
type Dock = Point & { cargo: number; occupant: number | null; unloadRate: number; angle: number };
type ShipState = 'sailing' | 'docking' | 'unloading' | 'waiting';
type Ship = Point & {
  id: number;
  cargoType: number;
  cargo: number;
  size: number;
  angle: number;
  speed: number;
  state: ShipState;
  path: Point[];
  dock: Dock | null;
  targetDock?: Dock | null;
  unloadTime: number;
  entered: boolean;
  /** Per-boat warning state and time since last warning horn. */
  warning?: boolean;
  warningTimer?: number;
};

type Pacing = {from: number; interval: number; maxSmall: number; maxMedium: number; maxLarge: number};
type Level = { width: number; height: number; docks: Dock[]; land: Point[][]; pacing: Pacing[] };

export interface GameCallbacks {
  onScore?: (score: number) => void;
  onGameOver?: (score: number) => void;
  onStatus?: (message: string) => void;
}

export interface GameController {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  destroy(): void;
  setEffectsVolume(volume: number): void;
  setAutoDock(enabled: boolean): void;
  snapshot(shiftId: string): ShiftSave | null;
  restore(snapshot: ShiftSave): boolean;
}

function parseLevel(text: string): Level {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const mapLine = lines.find(line => line.startsWith('mapSize '));
  const size = mapLine?.split(/\s+/).slice(1).map(Number) ?? [];
  const width = size[0] || 1024;
  const height = size[1] || 768;
  const docks: Dock[] = [];
  const land: Point[][] = [];
  const pacing: Pacing[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'dockElement') {
      const [x, y] = (lines[i + 1] || '').split(/\s+/).map(Number);
      const cargo = Number(lines[i + 6]);
      const unloadRate = Number(lines[i + 4]);
      const angle = Number(lines[i + 2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(cargo)) {
        docks.push({ x, y: height - y, cargo, occupant: null, unloadRate: unloadRate > 0 ? unloadRate : 1, angle });
      }
    } else if (lines[i] === 'landElement') {
      const n = Number(lines[i + 1]);
      if (!Number.isInteger(n) || n < 3 || n > 1000 || i + 1 + n >= lines.length) continue;
      const polygon: Point[] = [];
      for (let j = 0; j < n; j++) {
        const [x, y] = lines[i + 2 + j].split(/\s+/).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) polygon.push({ x: x + width / 2, y: height / 2 - y });
      }
      if (polygon.length === n) land.push(polygon);
      i += n + 1;
    } else if (lines[i] === 'pacingElement') {
      const from = Number(lines[i + 1]?.split(/\s+/)[0]);
      const parameters = lines[i + 2]?.split(/\s+/).map(Number) || [];
      const interval = parameters[0];
      if (Number.isFinite(from) && interval > 0) pacing.push({from, interval, maxSmall: parameters[3] || 0, maxMedium: parameters[4] || 0, maxLarge: parameters[5] || 0});
    }
  }
  if (!docks.length) throw new Error('The selected level does not contain any docks.');
  return { width, height, docks, land, pacing };
}

/** Metadata required to reject saves from different or incompatible level data. */
export function saveLevelForAssets(levelText: string): SaveLevel {
  const level = parseLevel(levelText);
  return { fingerprint: fingerprintLevel(levelText), width: level.width, height: level.height,
    dockCargoTypes: level.docks.map(dock => dock.cargo) };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Clip a player's route to the first shoreline it crosses. */
function clipSegment(start: Point, end: Point, polygons: Point[][]): Point | null {
  const rx = end.x - start.x, ry = end.y - start.y;
  let earliest = Infinity;
  for (const polygon of polygons) {
    // Departing docks can begin within the shore boundary; allow a path out.
    if (insidePolygon(start, polygon)) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const sx = b.x - a.x, sy = b.y - a.y;
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-9) continue;
      const qx = a.x - start.x, qy = a.y - start.y;
      const t = (qx * sy - qy * sx) / denominator;
      const u = (qx * ry - qy * rx) / denominator;
      if (t > .0001 && t <= 1 && u >= 0 && u <= 1) earliest = Math.min(earliest, t);
    }
  }
  return Number.isFinite(earliest) ? {x: start.x + rx * earliest, y: start.y + ry * earliest} : null;
}

/** Find the first shoreline crossed by the boat's center during this frame. */
function shoreContact(start: Point, end: Point, polygon: Point[]): {nx: number; ny: number} | null {
  const rx = end.x - start.x, ry = end.y - start.y;
  let earliest = Infinity, normal: {nx: number; ny: number} | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const sx = b.x - a.x, sy = b.y - a.y;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-9) continue;
    const qx = a.x - start.x, qy = a.y - start.y;
    const t = (qx * sy - qy * sx) / denominator;
    const u = (qx * ry - qy * rx) / denominator;
    if (t < -1e-8 || t > 1 || u < 0 || u > 1 || t >= earliest) continue;
    const length = Math.hypot(sx, sy);
    if (length < 1e-9) continue;
    let nx = -sy / length, ny = sx / length;
    const x = start.x + rx * t, y = start.y + ry * t;
    if (insidePolygon({x: x + nx * .1, y: y + ny * .1}, polygon)) { nx = -nx; ny = -ny; }
    // A boat leaving a berth on the boundary is allowed to move outward.
    if (rx * nx + ry * ny >= -1e-9) continue;
    earliest = t;
    normal = {nx, ny};
  }
  return normal;
}

/** Narrow-phase hull overlap: much closer to the narrow native boat polygons
 * than treating each boat as a circle as long as the whole hull. */
function hull(ship: Ship): Point[] {
  const shape = [[13,0],[6,-4],[-1,-6],[-7,-5],[-12,-3],[-12,3],[-7,5],[-1,6],[6,4]];
  const front = [13,15,22][ship.size], back = [12,22,41][ship.size], halfWidth = [6,7,9][ship.size];
  const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
  return shape.map(([x,y]) => {
    const localX = x >= 0 ? x * front / 13 : x * back / 12;
    const localY = y * halfWidth / 6;
    return {x: ship.x + localX * c - localY * s, y: ship.y + localX * s + localY * c};
  });
}

function hullsOverlap(a: Ship, b: Ship): boolean {
  if (distance(a, b) > [13,22,41][a.size] + [13,22,41][b.size]) return false;
  const first = hull(a), second = hull(b);
  for (const polygon of [first, second]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const nx = -(q.y - p.y), ny = q.x - p.x;
      const aa = first.map(point => point.x * nx + point.y * ny);
      const bb = second.map(point => point.x * nx + point.y * ny);
      if (Math.max(...aa) < Math.min(...bb) || Math.max(...bb) < Math.min(...aa)) return false;
    }
  }
  return true;
}

/**
 * Create a new game for the imported level. Does not start until start() is called.
 * Pointer coordinates are transformed from CSS pixels into level coordinates.
 */
export function createGame(canvas: HTMLCanvasElement, assets: GameAssets, callbacks: GameCallbacks = {}): GameController {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available on this device.');
  const ctx: CanvasRenderingContext2D = context;
  const level = parseLevel(assets.levelText);
  canvas.width = level.width;
  canvas.height = level.height;
  canvas.style.touchAction = 'none';

  const audio = new Map<string, HTMLAudioElement>();
  const audioUrls: string[] = [];
  for (const [name, blob] of Object.entries(assets.sounds)) {
    const url = URL.createObjectURL(blob);
    audioUrls.push(url);
    const element = new Audio(url);
    element.preload = 'auto';
    audio.set(name.replace(/\.[^.]+$/, '').toLowerCase(), element);
  }
  let effectsVolume = 0.65;
  let autoDockEnabled = true;
  function sound(name: string) {
    const element = audio.get(name.toLowerCase());
    if (!element || effectsVolume <= 0) return;
    try {
      // The same sound can overlap when multiple ships arrive in quick succession.
      const playback = element.cloneNode() as HTMLAudioElement;
      playback.volume = effectsVolume;
      void playback.play().catch(() => { /* Browsers may restrict audio until a tap. */ });
    } catch { /* Audio is optional; never interrupt play. */ }
  }

  let ships: Ship[] = [];
  let score = 0;
  let nextId = 0;
  const pressureConfig = parsePressureConfig(assets.levelText);
  const readLevelNumber = (key: string, fallback: number) => {
    const line = assets.levelText.split(/\r?\n/).find(row => row.trim().startsWith(key + ' '));
    const value = Number(line?.trim().split(/\s+/)[1]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const initialPacing: Pacing = { from: 0, interval: pressureConfig.initialBoatInterval,
    maxSmall: readLevelNumber('maxSmallBoats', 999), maxMedium: readLevelNumber('maxMediumBoats', 0),
    maxLarge: readLevelNumber('maxLargeBoats', 0) };
  let activePacing = {...initialPacing};
  let pressure = initialPressure(pressureConfig);
  let elapsed = 0;
  let running = false;
  let destroyed = false;
  let gameOver = false;
  let lastFrame = 0;
  let animationFrame = 0;
  type ActiveRoute = {ship: Ship; draft: Point[]; blocked: boolean; targetDock: Dock | null; lastTouch: Point};
  const routes = new Map<number, ActiveRoute>();
  type WakeSegment = Point & { angle: number; age: number; size: number };
  type BoatWake = { sinceLast: number; segments: WakeSegment[] };
  const wakes = new Map<number, BoatWake>();
  let routeFlash: (Point & { age: number }) | null = null;
  // The HD executable gives each boat 20 wake sprites, emits them at
  // size-specific intervals, and fades them over three to five seconds.
  const wakeIntervals = [.15, .3, .5];
  const wakeLifetimes = [3, 4, 5];
  const wakeScales = [.75, .95, 1.15];
  const wakeOffsets = [4, 12, 28];

  function ageWakes(dt: number) {
    for (const wake of wakes.values()) {
      for (const segment of wake.segments) segment.age += dt;
      wake.segments = wake.segments.filter(segment => segment.age < wakeLifetimes[segment.size]);
    }
  }

  function leaveWake(ship: Ship, previous: Point, dt: number) {
    if (dt <= 0 || distance(ship, previous) < 1e-8) return;
    let wake = wakes.get(ship.id);
    if (!wake) { wake = { sinceLast: 0, segments: [] }; wakes.set(ship.id, wake); }
    const interval = wakeIntervals[ship.size];
    wake.sinceLast += dt;
    while (wake.sinceLast >= interval) {
      wake.sinceLast -= interval;
      const progress = clamp(1 - wake.sinceLast / dt, 0, 1);
      const back = wakeOffsets[ship.size];
      wake.segments.push({
        x: previous.x + (ship.x - previous.x) * progress - Math.cos(ship.angle) * back,
        y: previous.y + (ship.y - previous.y) * progress - Math.sin(ship.angle) * back,
        angle: ship.angle, age: wake.sinceLast, size: ship.size,
      });
      if (wake.segments.length > 20) wake.segments.shift();
    }
  }

  // The HD app measures auto-docking from a point 20 units in front of
  // the berth. Drawn routes target a point 10 units in front of it.
  function dockApproach(dock: Dock, offset: number): Point {
    const angle = -dock.angle * Math.PI / 180;
    return { x: dock.x - Math.cos(angle) * offset, y: dock.y - Math.sin(angle) * offset };
  }
  function drawnDock(ship: Ship, point: Point): Dock | null {
    if (ship.cargo <= 0) return null;
    return level.docks.find(dock => {
      if (dock.cargo !== ship.cargoType || dock.occupant !== null) return false;
      const approach = dockApproach(dock, 10);
      return distance(point, approach) < 40 && distance(ship, approach) > 40;
    }) || null;
  }

  function updateScore() { callbacks.onScore?.(score); }
  function reset() {
    ships = [];
    for (const dock of level.docks) dock.occupant = null;
    score = 0;
    nextId = 0;
    elapsed = 0;
    activePacing = {...initialPacing};
    pressure = initialPressure(pressureConfig);
    routes.clear();
    wakes.clear();
    routeFlash = null;
    gameOver = false;
    lastFrame = 0;
    updateScore();
    callbacks.onStatus?.('Draw a route from each boat to a matching dock.');
  }

  function spawn(): boolean {
    const counts = [0, 0, 0];
    for (const ship of ships) counts[ship.size]++;
    const size = chooseBoatSize(counts, [activePacing.maxSmall, activePacing.maxMedium, activePacing.maxLarge]);
    if (size === null) return false;
    const candidate = chooseSpawnCandidate(level.width, level.height, size, c => {
      if (level.land.some(p => insidePolygon(c.entry, p) || insidePolygon(c.clearance, p))) return false;
      if (clipSegment(c.entry, c.clearance, level.land)) return false;
      return !ships.some(ship => distance(ship, c.entry) < [50, 60, 75][size]);
    });
    if (!candidate) return false;
    const cargoTypes = [...new Set(level.docks.map(dock => dock.cargo))];
    const cargoType = cargoTypes[Math.floor(Math.random() * cargoTypes.length)];
    ships.push({
      id: nextId++, x: candidate.start.x, y: candidate.start.y, angle: candidate.angle, speed: [40,20,10][size],
      size, cargoType, cargo: [1,2,4][size],
      state: 'sailing', path: [], dock: null, unloadTime: 0, entered: false,
    });
    return true;
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;
    routes.clear();
    sound('crash');
    callbacks.onStatus?.('Collision! Try again?');
    callbacks.onGameOver?.(score);
  }

  function update(dt: number) {
    ageWakes(dt);
    if (routeFlash) {
      routeFlash.age += dt;
      if (routeFlash.age >= .375) routeFlash = null;
    }
    // Warnings belong to individual boats. The original excludes boats still
    // entering and uses their size-specific radii and a four-second horn timer.
    for (const ship of ships) {
      ship.warning = false;
      ship.warningTimer = (ship.warningTimer ?? 0) + dt;
    }
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        if (!a.entered || !b.entered) continue;
        if (distance(a, b) < [20, 30, 40][a.size] + [20, 30, 40][b.size]) {
          a.warning = true;
          b.warning = true;
        }
      }
    }
    for (const ship of ships) {
      if (ship.warning && (ship.warningTimer ?? 0) > 4) {
        sound(ship.size === 2 ? 'warningLarge' : 'warningSmall');
        ship.warningTimer = 0;
      }
    }
    elapsed += dt;
    const decision = advancePressure(pressure, pressureConfig, {
      boats: ships.map(ship => ({size: ship.size as 0 | 1 | 2, spawning: !ship.entered,
        unloaded: ship.cargo === 0, docked: ship.state === 'unloading' || ship.state === 'waiting',
        warning: !!ship.warning})),
      occupiedDocks: level.docks.filter(dock => dock.occupant !== null).length,
      totalDocks: level.docks.length,
    }, dt, activePacing.interval);
    pressure = decision.state;
    if (decision.applyPacing) activePacing = level.pacing.filter(p => p.from <= score).at(-1) || activePacing;
    if (decision.shouldSpawn && spawn()) pressure = recordSuccessfulSpawn(pressure);
    for (const ship of ships) {
      if (ship.state === 'docking') {
        const dock = ship.dock!;
        const previous = { x: ship.x, y: ship.y };
        const remaining = distance(ship, dock);
        const step = Math.min(remaining, ship.speed * dt);
        if (remaining > 0) {
          ship.x += (dock.x - ship.x) / remaining * step;
          ship.y += (dock.y - ship.y) / remaining * step;
        }
        leaveWake(ship, previous, dt);
        if (remaining <= step + .01) {
          ship.x = dock.x; ship.y = dock.y;
          dock.occupant = ship.id;
          ship.state = 'unloading';
          ship.unloadTime = 2 / dock.unloadRate;
          sound('shipBell');
          callbacks.onStatus?.('Unloading cargo…');
        }
        continue;
      }
      if (ship.state === 'unloading') {
        ship.unloadTime -= dt;
        if (ship.unloadTime <= 0) {
          // The iPad app unloads each cargo unit separately at two seconds per
          // unit, divided by the dock's speed-up factor.
          score++;
          ship.cargo--;
          sound('unloaded');
          updateScore();
          if (ship.cargo > 0) ship.unloadTime += 2 / (ship.dock?.unloadRate || 1);
          else {
            ship.state = 'waiting';
            ship.path = [];
            callbacks.onStatus?.('Cargo delivered! Draw a route back out to sea.');
          }
        }
        continue;
      }
      if (ship.state === 'waiting') continue;
      const previous = { x: ship.x, y: ship.y };
      // The original advances the boat along the actual path, consuming
      // speed × elapsed time across as many path segments as necessary. Its
      // heading turns separately; steering the velocity toward each waypoint
      // instead cuts corners and causes large, unintentional detours.
      let remainingTravel = ship.speed * dt;
      while (ship.path.length && remainingTravel > 0) {
        const target = ship.path[0];
        const dx = target.x - ship.x, dy = target.y - ship.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-8) { ship.path.shift(); continue; }
        const step = Math.min(remainingTravel, length);
        const direction = Math.atan2(dy, dx);
        const turn = Math.atan2(Math.sin(direction - ship.angle), Math.cos(direction - ship.angle));
        const maxTurn = [120, 40, 10][ship.size] * Math.PI / 180;
        ship.angle += clamp(turn, -maxTurn * step / ship.speed, maxTurn * step / ship.speed);
        ship.x += dx / length * step;
        ship.y += dy / length * step;
        remainingTravel -= step;
        if (length - step < 1e-8) ship.path.shift();
      }
      if (remainingTravel > 0 && !ship.path.length) {
        ship.x += Math.cos(ship.angle) * remainingTravel;
        ship.y += Math.sin(ship.angle) * remainingTravel;
      }

      // While following a curve the rendered heading may lag behind the
      // traveled segment. Use the actual motion, not that visual heading,
      // when deciding whether the boat crossed a boundary and how to reflect.
      const dx = ship.x - previous.x, dy = ship.y - previous.y;
      const moved = Math.hypot(dx, dy);
      let motionX = moved > 1e-9 ? dx / moved : Math.cos(ship.angle);
      let motionY = moved > 1e-9 ? dy / moved : Math.sin(ship.angle);

      if (!ship.entered && ship.x >= 0 && ship.x <= level.width && ship.y >= 0 && ship.y <= level.height) ship.entered = true;
      if (ship.entered && ship.cargo > 0) {
        let bounced = false;
        if (ship.x < 0 || ship.x > level.width) { ship.x = previous.x; motionX = -motionX; bounced = true; }
        if (ship.y < 0 || ship.y > level.height) { ship.y = previous.y; motionY = -motionY; bounced = true; }
        if (bounced) { ship.angle = Math.atan2(motionY, motionX); ship.path.length = 0; ship.targetDock = null; }
      }

      // Auto-docking is a separate convenience in the original app. A ship
      // should not divert from an unrelated route just because it sails near a
      // berth, and should never auto-dock while its path is being edited.
      if (ship.cargo > 0 && (ship.targetDock || ![...routes.values()].some(route => route.ship === ship))) {
        const activeTarget = ship.targetDock;
        const canAutoDock = autoDockEnabled && !activeTarget && ship.path.length === 0 && !ship.warning;
        const dock = level.docks.find(candidate => {
          if (candidate.cargo !== ship.cargoType || candidate.occupant !== null) return false;
          if (activeTarget !== candidate && !canAutoDock) return false;
          return distance(ship, dockApproach(candidate, 20)) < 24;
        });
        if (dock) {
          ship.dock = dock;
          ship.targetDock = null;
          ship.state = 'docking';
          ship.path.length = 0;
        }
      }
      if (ship.state === 'sailing') {
        // Dock mouths sit next to the land polygon, so a valid docking approach
        // takes precedence. The original HD simulation reflects ships off
        // land, clears their path and keeps the game going.
        for (const polygon of level.land) {
          const contact = shoreContact(previous, ship, polygon);
          if (!contact) continue;
          const vx = motionX, vy = motionY;
          const intoLand = vx * contact.nx + vy * contact.ny;
          // A boat leaving an occupied berth is already near shore: permit it
          // to move away rather than bouncing it back into the dock.
          if (intoLand >= -0.001) continue;
          ship.x = previous.x;
          ship.y = previous.y;
          ship.angle = Math.atan2(vy - 2 * intoLand * contact.ny, vx - 2 * intoLand * contact.nx);
          ship.path.length = 0;
          ship.targetDock = null;
          callbacks.onStatus?.('The boat bounced off the shore. Draw a new route.');
          break;
        }
      }
      leaveWake(ship, previous, dt);
    }
    // Empty boats leave safely. Behavior of loaded boats at the edge is kept
    // deliberately separate while original handling is verified.
    ships = ships.filter(ship => {
      if (ship.x > -80 && ship.x < level.width + 80 && ship.y > -80 && ship.y < level.height + 80) return true;
      if (ship.dock && ship.dock.occupant === ship.id) ship.dock.occupant = null;
      return false;
    });
    const activeIds = new Set(ships.map(ship => ship.id));
    for (const id of wakes.keys()) if (!activeIds.has(id)) wakes.delete(id);
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        if (hullsOverlap(a, b)) { endGame(); return; }
      }
    }
  }

  function drawPath(points: Point[], start: Point, valid: boolean) {
    if (!points.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    // cBoat::drawPath uses a continuous translucent blue line for routes
    // ending at a dock or map edge, and an opaque red line otherwise.
    ctx.strokeStyle = valid ? 'rgba(166, 196, 227, .4)' : 'rgb(217, 85, 77)';
    ctx.lineWidth = valid ? 4 : 3;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  function drawWakes() {
    if (!assets.sprites.complete || !(assets.sprites.naturalWidth >= 175 && assets.sprites.naturalHeight >= 44)) return;
    for (const wake of wakes.values()) for (const segment of wake.segments) {
      const progress = segment.age / wakeLifetimes[segment.size];
      const scale = Math.max(0, wakeScales[segment.size] - progress);
      if (scale === 0) continue;
      ctx.save();
      ctx.translate(segment.x, segment.y);
      ctx.rotate(segment.angle);
      ctx.globalAlpha = 1 - progress;
      // Reuse the foam sprite from the player's own HD atlas; no game artwork
      // is included in the repository.
      ctx.drawImage(assets.sprites, 146, 22, 29, 22, -14.5 * scale, -11 * scale, 29 * scale, 22 * scale);
      ctx.restore();
    }
  }

  function drawRouteFlash() {
    if (!routeFlash || !assets.sprites.complete || !(assets.sprites.naturalWidth >= 32 && assets.sprites.naturalHeight >= 128)) return;
    // The HD app uses the atlas's soft 32 × 32 white sprite, starting at
    // 75% opacity and triple size, then fades and shrinks it over 0.375 s.
    const scale = 3 - routeFlash.age * 2;
    ctx.save();
    ctx.globalAlpha = .75 - routeFlash.age * 2;
    ctx.drawImage(assets.sprites, 0, 96, 32, 32,
      routeFlash.x - 16 * scale, routeFlash.y - 16 * scale, 32 * scale, 32 * scale);
    ctx.restore();
  }

  function drawShip(ship: Ship) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    const length = [32, 44, 70][ship.size];
    const height = [16, 18, 22][ship.size];
    ctx.shadowColor = 'rgba(0, 21, 34, .55)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    if (assets.sprites.complete && assets.sprites.naturalWidth > 0) {
      // Coordinates recovered from the native HD texture setup. Each hull
      // size has its own atlas height and a different unloaded-row offset.
      const sx = [0, 32, 76][ship.size];
      const sy = ship.cargo ? 0 : [16, 18, 22][ship.size];
      ctx.drawImage(assets.sprites, sx, sy, length, height, -length / 2, -height / 2, length, height);
    } else {
      ctx.fillStyle = '#f5f2e7';
      ctx.beginPath(); ctx.ellipse(0, 0, length / 2, height / 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowColor = 'transparent';
    if (ship.cargo) {
      ctx.fillStyle = ship.cargoType === 0 ? '#ffbe39' : '#aa50dc';
      ctx.strokeStyle = 'rgba(28, 28, 34, .8)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < ship.cargo; i++) {
        ctx.fillRect(-7 + i * 8, -5, 7, 10);
        ctx.strokeRect(-7 + i * 8, -5, 7, 10);
      }
    }
    if (ship.state === 'waiting') {
      ctx.rotate(-ship.angle);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#06465b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -25, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#06465b'; ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, -25);
    }
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, level.width, level.height);
    if (assets.background.complete && assets.background.naturalWidth > 0) {
      ctx.drawImage(assets.background, 0, 0, level.width, level.height);
    } else {
      ctx.fillStyle = '#147aa4'; ctx.fillRect(0, 0, level.width, level.height);
    }
    const routeIsValid = (ship: Ship, points: Point[]) => {
      const end = points.at(-1);
      if (!end) return false;
      return ship.cargo > 0
        ? level.docks.some(dock => dock.cargo === ship.cargoType && dock.occupant === null && distance(end, dock) <= 44)
        : end.x <= 15 || end.x >= level.width - 15 || end.y <= 15 || end.y >= level.height - 15;
    };
    for (const ship of ships) {
      if (![...routes.values()].some(route => route.ship === ship)) drawPath(ship.path, ship, routeIsValid(ship, ship.path));
    }
    for (const {ship, draft} of routes.values()) drawPath(draft, ship, routeIsValid(ship, draft));
    drawWakes();
    for (const ship of ships) drawShip(ship);
    drawRouteFlash();
  }

  function frame(timestamp: number) {
    if (destroyed || !running) return;
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .05) : 0;
    lastFrame = timestamp;
    update(dt);
    render();
    if (running) animationFrame = requestAnimationFrame(frame);
  }

  function canvasPoint(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * level.width / rect.width, -45, level.width + 45),
      y: clamp((event.clientY - rect.top) * level.height / rect.height, -45, level.height + 45) };
  }
  function pointerDown(event: PointerEvent) {
    if (!running || routes.has(event.pointerId)) return;
    const p = canvasPoint(event);
    routeFlash = { ...p, age: 0 };
    let nearest: Ship | undefined;
    let nearestDistance = 48;
    for (const ship of ships) {
      if (ship.state === 'docking' || ship.state === 'unloading' || [...routes.values()].some(route => route.ship === ship)) continue;
      const d = distance(p, ship);
      if (d < nearestDistance) { nearest = ship; nearestDistance = d; }
    }
    if (!nearest) return;
    event.preventDefault();
    // The original clears the existing route as soon as the player selects a
    // ship, but the ship keeps moving while the replacement path is drawn.
    nearest.path = [];
    nearest.targetDock = null;
    // The path belongs to the boat while it is being drawn. Simulation shifts
    // completed points from this same array, so it responds before pointer-up.
    routes.set(event.pointerId, {ship: nearest, draft: nearest.path, blocked: false, targetDock: null, lastTouch: p});
    canvas.setPointerCapture(event.pointerId);
    sound('startPath');
  }
  function appendRoutePoint(route: ActiveRoute, point: Point) {
    if (route.blocked) return;
    const previous = route.draft[route.draft.length - 1] || route.ship;
    // The HD controller tests the dock target before clipping against land.
    const target = drawnDock(route.ship, point);
    if (target) {
      routeFlash = { x: target.x, y: target.y, age: 0 };
      route.targetDock = target;
      route.ship.targetDock = target;
      route.draft.push(dockApproach(target, 20));
      route.blocked = true;
      route.lastTouch = point;
      return;
    }
    const unit = (v: Point, fallback: Point): Point => {
      const length = Math.hypot(v.x, v.y);
      return length > 1e-9 ? {x: v.x / length, y: v.y / length} : fallback;
    };
    const heading = {x: Math.cos(route.ship.angle), y: Math.sin(route.ship.angle)};
    const before = route.draft[route.draft.length - 2];
    const startDirection = before ? unit({x: previous.x - before.x, y: previous.y - before.y}, heading) : heading;
    const endDirection = unit({x: point.x - route.lastTouch.x, y: point.y - route.lastTouch.y}, startDirection);
    const candidates = nativeTouchSegment(previous, point, startDirection, endDirection);
    if (candidates.length && route.ship.state === 'waiting') {
      // An unloaded, docked vessel starts to depart as soon as a route exists,
      // rather than waiting for the finger to be lifted.
      const dock = route.ship.dock;
      if (dock) {
        route.ship.angle = -dock.angle * Math.PI / 180 + Math.PI;
        if (dock.occupant === route.ship.id) dock.occupant = null;
        route.ship.dock = null;
      }
      route.ship.state = 'sailing';
    }
    for (const candidate of candidates) {
      const start = route.draft[route.draft.length - 1] || route.ship;
      const clipped = clipSegment(start, candidate, level.land);
      route.draft.push(clipped || candidate);
      if (clipped) { route.blocked = true; break; }
    }
    route.lastTouch = point;
  }
  function pointerMove(event: PointerEvent) {
    const route = routes.get(event.pointerId);
    if (!route || route.blocked) return;
    event.preventDefault();
    appendRoutePoint(route, canvasPoint(event));
  }
  function pointerUp(event: PointerEvent) {
    const route = routes.get(event.pointerId);
    if (!route) return;
    event.preventDefault();
    if (route.draft.length || route.targetDock) {
      sound('endPath');
      callbacks.onStatus?.('');
    }
    routes.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function pointerCancel(event: PointerEvent) {
    routes.delete(event.pointerId);
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);

  function snapshot(shiftId: string): ShiftSave | null {
    if (destroyed || gameOver) return null;
    const saved: ShiftSave = {
      version: 1, levelFingerprint: fingerprintLevel(assets.levelText), shiftId,
      score, nextId, elapsed, spawnIn: 0, lastWarning: 0,
      pressure: {...pressure}, activePacing: {...activePacing},
      ships: ships.map(ship => ({
        id: ship.id, x: ship.x, y: ship.y, angle: ship.angle, speed: ship.speed, size: ship.size,
        cargoType: ship.cargoType, cargo: ship.cargo, state: ship.state,
        path: ship.path.map(point => ({...point})),
        dockIndex: ship.dock ? level.docks.indexOf(ship.dock) : null,
        targetDockIndex: ship.targetDock ? level.docks.indexOf(ship.targetDock) : null,
        unloadTime: ship.unloadTime, entered: ship.entered,
        warning: ship.warning ?? false, warningTimer: ship.warningTimer ?? 0,
      })),
    };
    return isValidShiftSave(saved, saveLevelForAssets(assets.levelText)) ? saved : null;
  }
  function restore(saved: ShiftSave): boolean {
    if (destroyed || running || !saved.pressure || !saved.activePacing || !isValidShiftSave(saved, saveLevelForAssets(assets.levelText))) return false;
    // Validation happens before touching the active simulation. Restore canonical
    // dock references instead of copying circular ship/dock objects from JSON.
    const restored: Ship[] = saved.ships.map(ship => ({
      id: ship.id, x: ship.x, y: ship.y, angle: ship.angle, speed: ship.speed, size: ship.size,
      cargoType: ship.cargoType, cargo: ship.cargo, state: ship.state,
      path: ship.path.map(point => ({...point})),
      dock: ship.dockIndex === null ? null : level.docks[ship.dockIndex],
      targetDock: ship.targetDockIndex === null ? null : level.docks[ship.targetDockIndex],
      unloadTime: ship.unloadTime, entered: ship.entered,
      warning: ship.warning ?? false, warningTimer: ship.warningTimer ?? 0,
    }));
    for (const dock of level.docks) dock.occupant = null;
    for (const ship of restored) if ((ship.state === 'waiting' || ship.state === 'unloading') && ship.dock) ship.dock.occupant = ship.id;
    ships = restored;
    score = saved.score; nextId = saved.nextId; elapsed = saved.elapsed;
    pressure = {...saved.pressure};
    activePacing = {...saved.activePacing, maxSmall: saved.activePacing.maxSmall ?? initialPacing.maxSmall};
    routes.clear(); wakes.clear(); routeFlash = null; gameOver = false; lastFrame = 0;
    updateScore(); render();
    return true;
  }

  function resume() {
    if (destroyed || running || gameOver) return;
    running = true;
    lastFrame = 0;
    animationFrame = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(animationFrame);
    lastFrame = 0;
    routes.clear();
  }
  reset();
  render();
  return {
    start: resume,
    pause,
    resume,
    restart() { pause(); reset(); render(); resume(); },
    setEffectsVolume(volume: number) { effectsVolume = clamp(volume, 0, 1); },
    setAutoDock(enabled: boolean) { autoDockEnabled = enabled; },
    snapshot,
    restore,
    destroy() {
      pause(); destroyed = true;
      wakes.clear();
      routeFlash = null;
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      for (const element of audio.values()) { element.pause(); element.removeAttribute('src'); }
      for (const url of audioUrls) URL.revokeObjectURL(url);
    },
  };
}
