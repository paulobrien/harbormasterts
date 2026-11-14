/** Candidate generation based on the HD app's four-edge random entry behavior.
 * Coordinates use the canvas convention (origin top left). The original heads each new boat toward the map center.
 */
export type SpawnPoint = { x: number; y: number };
export type BoatSize = 0 | 1 | 2;
export type SpawnCandidate = {
  size: BoatSize;
  start: SpawnPoint;
  entry: SpawnPoint;
  target: SpawnPoint;
  clearance: SpawnPoint;
  angle: number;
  edge: 'left' | 'right' | 'top' | 'bottom';
};
export type RandomSource = () => number;

const unit = (value: number): number => Math.min(.9999999999999999, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Select uniformly among the boat types that have capacity remaining.
 * Native HD code checks the active count of each type against the corresponding
 * cap and uses a random modulo of the number of available alternatives.
 */
export function chooseBoatSize(counts: readonly number[], maxima: readonly number[], random: RandomSource = Math.random): BoatSize | null {
  const available: BoatSize[] = [];
  for (let size = 0 as BoatSize; size <= 2; size = (size + 1) as BoatSize) {
    if ((counts[size] || 0) < (maxima[size] || 0)) available.push(size);
  }
  return available.length ? available[Math.floor(unit(random()) * available.length)] : null;
}

/**
 * Try up to eleven randomly chosen edges and positions, heading toward the map
 * center. `isClear` should reject entry-to-clearance segments crossing land or
 * rocks and conflicting with ships. Null means the caller should retry later.
 */
export function chooseSpawnCandidate(
  width: number,
  height: number,
  size: BoatSize,
  isClear: (candidate: SpawnCandidate) => boolean,
  random: RandomSource = Math.random,
): SpawnCandidate | null {
  if (!(width > 0 && height > 0)) return null;
  const edges = ['left', 'right', 'top', 'bottom'] as const;
  const offset = [30, 15, 25][size]; // Per-type original offsets from the entry point.
  for (let attempt = 0; attempt < 11; attempt++) {
    const edge = edges[Math.floor(unit(random()) * edges.length)];
    const along = unit(random());
    const entry = edge === 'left' ? {x: 0, y: along * height}
      : edge === 'right' ? {x: width, y: along * height}
      : edge === 'top' ? {x: along * width, y: 0}
      : {x: along * width, y: height};
    const target = {x: width / 2, y: height / 2};
    const clearance = edge === 'left' ? {x: 30, y: entry.y}
      : edge === 'right' ? {x: width - 30, y: entry.y}
      : edge === 'top' ? {x: entry.x, y: 30}
      : {x: entry.x, y: height - 30};
    const dx = target.x - entry.x, dy = target.y - entry.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const start = {x: entry.x - dx / length * offset, y: entry.y - dy / length * offset};
    const candidate: SpawnCandidate = {size, start, entry, target, clearance, angle: Math.atan2(dy, dx), edge};
    if (isClear(candidate)) return candidate;
  }
  return null;
}
