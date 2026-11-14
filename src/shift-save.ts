/** Safe, versioned local snapshots. No original assets are stored here. */
export type SavedPoint = { x: number; y: number };
export type SavedShipState = 'sailing' | 'docking' | 'unloading' | 'waiting';
export interface SavedShip {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  cargoType: number;
  cargo: number;
  state: SavedShipState;
  path: SavedPoint[];
  /** Index into the current parsed level's docks, or null. */
  dockIndex: number | null;
  targetDockIndex: number | null;
  unloadTime: number;
  entered: boolean;
  /** Elapsed portion of the original two-second arrival warning, if active. */
  spawnElapsed?: number;
  warning?: boolean;
  warningTimer?: number;
}
export interface SavedPressure {
  phase: 0 | 1 | 2 | 3;
  phaseElapsed: number;
  spawnElapsed: number;
  threshold: number;
}
export interface SavedActivePacing {
  from: number;
  interval: number;
  maxMedium: number;
  maxLarge: number;
  maxSmall?: number;
}
export interface ShiftSave {
  version: 1;
  levelFingerprint: string;
  shiftId: string;
  score: number;
  nextId: number;
  elapsed: number;
  spawnIn: number;
  lastWarning: number;
  ships: SavedShip[];
  /** Optional for compatible saves made before pressure simulation was added. */
  pressure?: SavedPressure;
  activePacing?: SavedActivePacing;
}
export interface SaveLevel {
  fingerprint: string;
  width: number;
  height: number;
  /** Colors of docks in their parsed, original order. */
  dockCargoTypes: number[];
}
type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;
const KEY = 'harbor-master-saved-shift-v1';
const MAX_SAVE_CHARS = 2_000_000;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number): v is number => finite(v, min, max) && Number.isSafeInteger(v);
const dockIndex = (v: unknown, count: number): v is number | null => v === null || integer(v, 0, count - 1);

/** Deterministic fingerprint of the user-provided level text, for compatibility checks. */
export function fingerprintLevel(text: string): string {
  // FNV-1a is used for identity/version matching, not cryptographic validation.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `level-${hash.toString(16).padStart(8, '0')}-${text.length}`;
}

/** Validate the entire snapshot before the game reconstructs any references. */
export function isValidShiftSave(value: unknown, level: SaveLevel): value is ShiftSave {
  if (!isRecord(value) || value.version !== 1 || value.levelFingerprint !== level.fingerprint) return false;
  if (typeof value.shiftId !== 'string' || value.shiftId.length < 1 || value.shiftId.length > 128) return false;
  if (!finite(level.width, 1, 100000) || !finite(level.height, 1, 100000) || !Array.isArray(level.dockCargoTypes) || level.dockCargoTypes.length === 0 || level.dockCargoTypes.length > 1000 || !level.dockCargoTypes.every(c => integer(c, 0, 255))) return false;
  if (!integer(value.score, 0, 1_000_000) || !integer(value.nextId, 0, 10_000_000) || !finite(value.elapsed, 0, 31_536_000) || !finite(value.spawnIn, -10, 86_400) || !finite(value.lastWarning, 0, 31_536_000)) return false;
  if (value.pressure !== undefined) {
    if (!isRecord(value.pressure) || !integer(value.pressure.phase, 0, 3) || !finite(value.pressure.phaseElapsed, 0, 31_536_000) || !finite(value.pressure.spawnElapsed, 0, 31_536_000) || !finite(value.pressure.threshold, 0, 1000)) return false;
  }
  if (value.activePacing !== undefined) {
    const pace = value.activePacing;
    if (!isRecord(pace) || !integer(pace.from, 0, 1_000_000) || !finite(pace.interval, .001, 86_400) || !integer(pace.maxMedium, 0, 1_000_000) || !integer(pace.maxLarge, 0, 1_000_000) || (pace.maxSmall !== undefined && !integer(pace.maxSmall, 0, 1_000_000))) return false;
  }
  if (!Array.isArray(value.ships) || value.ships.length > 200) return false;
  const ids = new Set<number>();
  const occupants = new Set<number>();
  let totalPoints = 0;
  for (const ship of value.ships) {
    if (!isRecord(ship) || !integer(ship.id, 0, 10_000_000) || ship.id >= value.nextId || ids.has(ship.id)) return false;
    ids.add(ship.id);
    if (!finite(ship.x, -256, level.width + 256) || !finite(ship.y, -256, level.height + 256) || !finite(ship.angle, -100_000, 100_000) || !finite(ship.speed, 0, 500) || !integer(ship.size, 0, 2) || !integer(ship.cargoType, 0, 255) || !integer(ship.cargo, 0, [1, 2, 4][ship.size])) return false;
    if (ship.state !== 'sailing' && ship.state !== 'docking' && ship.state !== 'unloading' && ship.state !== 'waiting') return false;
    if (!dockIndex(ship.dockIndex, level.dockCargoTypes.length) || !dockIndex(ship.targetDockIndex, level.dockCargoTypes.length) || !finite(ship.unloadTime, -1, 86_400) || typeof ship.entered !== 'boolean') return false;
    if (ship.spawnElapsed !== undefined && (!finite(ship.spawnElapsed, 0, 2) || ship.entered || ship.state !== 'sailing' || ship.dockIndex !== null || ship.targetDockIndex !== null)) return false;
    if ((ship.warning !== undefined && typeof ship.warning !== 'boolean') || (ship.warningTimer !== undefined && !finite(ship.warningTimer, 0, 31_536_000))) return false;
    if ((ship.state === 'docking' || ship.state === 'unloading' || ship.state === 'waiting') && ship.dockIndex === null) return false;
    if ((ship.state === 'docking' || ship.state === 'unloading') && ship.cargo === 0) return false;
    if (ship.state === 'waiting' && ship.cargo !== 0) return false;
    if (ship.dockIndex !== null && ship.cargo > 0 && level.dockCargoTypes[ship.dockIndex] !== ship.cargoType) return false;
    if (ship.targetDockIndex !== null && (ship.cargo === 0 || level.dockCargoTypes[ship.targetDockIndex] !== ship.cargoType)) return false;
    if (ship.state === 'unloading' || ship.state === 'waiting') {
      if (ship.dockIndex === null || occupants.has(ship.dockIndex)) return false;
      occupants.add(ship.dockIndex);
    }
    if (!Array.isArray(ship.path) || ship.path.length > 4096) return false;
    if (ship.spawnElapsed !== undefined && ship.path.length) return false;
    totalPoints += ship.path.length;
    if (totalPoints > 25_000 || !ship.path.every(point => isRecord(point) && finite(point.x, -256, level.width + 256) && finite(point.y, -256, level.height + 256))) return false;
  }
  return true;
}

/** Return null for missing, incompatible, malformed, or unavailable browser storage. */
export function readShiftSave(level: SaveLevel, storage: ReadStorage = localStorage): ShiftSave | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > MAX_SAVE_CHARS) return null;
    const value: unknown = JSON.parse(raw);
    return isValidShiftSave(value, level) ? value : null;
  } catch { return null; }
}

/** Refuse invalid snapshots and report quota / private-mode errors to the caller. */
export function writeShiftSave(value: ShiftSave, level: SaveLevel, storage: WriteStorage = localStorage): boolean {
  try {
    if (!isValidShiftSave(value, level)) return false;
    const raw = JSON.stringify(value);
    if (raw.length > MAX_SAVE_CHARS) return false;
    storage.setItem(KEY, raw);
    return true;
  } catch { return false; }
}
export function clearShiftSave(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try { storage.removeItem(KEY); } catch { /* Browser storage is optional. */ }
}
