/** Single-player pressure controller reconstructed from the HD game's executable.
 * Data values are read from the player's own level file. This module is pure;
 * callers own game time, spawn attempts, and the mutable collection of ships.
 */
export type PressureBoat = {
  size: 0 | 1 | 2;
  spawning: boolean;
  unloaded: boolean;
  docked: boolean;
  warning: boolean;
};
export type PressureConfig = {
  initialThreshold: number;
  sustainTime: number;
  restThreshold: number;
  spawnThreshold: number;
  relaxTime: number;
  initialBoatInterval: number;
  initialSpawnElapsed: number;
  incomingWeight: number;
  sizeWeights: readonly [number, number, number];
  warningWeight: number;
  allDocksWeight: number;
  cycloneWeight: number;
  pirateWeight: number;
  monsterWeight: number;
};
export type PressureSnapshot = {
  boats: readonly PressureBoat[];
  occupiedDocks: number;
  totalDocks: number;
  cyclones?: number;
  pirates?: number;
  monsters?: number;
};
/** State meanings: 0 normal, 1 sustain pressure, 2 wait to rest, 3 relax. */
export type PressureState = {
  phase: 0 | 1 | 2 | 3;
  phaseElapsed: number;
  spawnElapsed: number;
  threshold: number;
};
export type PressureDecision = {
  state: PressureState;
  stress: number;
  shouldSpawn: boolean;
  /** The HD app updates score-dependent pacing settings at the end of a rest cycle. */
  applyPacing: boolean;
};

export function parsePressureConfig(level: string): PressureConfig {
  const values = new Map<string, number>();
  for (const line of level.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z0-9]*)\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)\s*$/.exec(line);
    if (match) values.set(match[1], Number(match[2]));
  }
  const get = (key: string, fallback: number) => {
    const value = values.get(key);
    return value !== undefined && Number.isFinite(value) ? value : fallback;
  };
  return {
    initialThreshold: get('stressThreshold', .25), sustainTime: get('stressSustainTime', 60),
    restThreshold: get('stressRestThreshold', .3), spawnThreshold: get('stressSpawnThreshold', .1),
    relaxTime: get('stressRelaxTime', 2), initialBoatInterval: get('timeBetweenBoats', 3),
    initialSpawnElapsed: get('timeSinceLastBoat', .5), incomingWeight: get('stressNewBoatUnknown', .2),
    sizeWeights: [get('stressNewBoatSmall', .15), get('stressNewBoatMedium', .1), get('stressNewBoatLarge', .15)],
    warningWeight: get('stressWarning', .05), allDocksWeight: get('stressDocksFull', .1),
    cycloneWeight: get('stressCyclone', .15), pirateWeight: get('stressPirate', .1),
    monsterWeight: get('stressMonster', .1),
  };
}

export function initialPressure(config: PressureConfig): PressureState {
  return {phase: 0, phaseElapsed: 0, spawnElapsed: config.initialSpawnElapsed, threshold: config.initialThreshold};
}

export function calculateStress(config: PressureConfig, snapshot: PressureSnapshot): number {
  let stress = 0;
  for (const boat of snapshot.boats) {
    let contribution = boat.spawning ? config.incomingWeight : config.sizeWeights[boat.size];
    if (boat.unloaded) contribution *= .5;
    if (boat.docked) contribution = 0;
    stress += contribution;
    if (boat.warning) stress += config.warningWeight;
  }
  // The native routine skips the all-docks-full comparison when there are no boats.
  if (snapshot.boats.length > 0 && snapshot.occupiedDocks === snapshot.totalDocks) stress += config.allDocksWeight;
  stress += (snapshot.cyclones || 0) * config.cycloneWeight;
  stress += (snapshot.pirates || 0) * config.pirateWeight;
  stress += (snapshot.monsters || 0) * config.monsterWeight;
  return stress;
}

/**
 * Produce at most one spawn request per update. Call after each actual success
 * to reset elapsed time using `recordSuccessfulSpawn`. A rejected attempt must
 * retain elapsed time, allowing the next update to try another safe candidate.
 * `boatInterval` is the active interval, initially config.initialBoatInterval;
 * on applyPacing, the caller can update it and active caps from the score stage.
 */
export function advancePressure(
  previous: PressureState,
  config: PressureConfig,
  snapshot: PressureSnapshot,
  dt: number,
  boatInterval: number,
): PressureDecision {
  const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const state: PressureState = {...previous, phaseElapsed: previous.phaseElapsed + delta, spawnElapsed: previous.spawnElapsed + delta};
  const stress = calculateStress(config, snapshot);
  let shouldSpawn = false, applyPacing = false;
  switch (state.phase) {
    case 0:
      shouldSpawn = state.spawnElapsed >= boatInterval;
      if (stress >= state.threshold) { state.phase = 1; state.phaseElapsed = 0; }
      break;
    case 1:
      shouldSpawn = stress < state.threshold - config.spawnThreshold;
      if (state.phaseElapsed >= state.threshold * config.sustainTime) { state.phase = 2; state.phaseElapsed = 0; }
      break;
    case 2:
      if (stress <= config.restThreshold) { state.phase = 3; state.phaseElapsed = 0; }
      break;
    case 3:
      if (state.phaseElapsed >= config.relaxTime) {
        state.phase = 0; state.phaseElapsed = 0;
        if (state.threshold < .55) state.threshold += .1;
        else if (state.threshold < .85) state.threshold += .05;
        state.threshold += .01;
        applyPacing = true;
      }
      break;
  }
  return {state, stress, shouldSpawn, applyPacing};
}

export function recordSuccessfulSpawn(state: PressureState): PressureState {
  return {...state, spawnElapsed: 0};
}
