import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'harbor-stress-test-'));
try {
 const out=join(dir,'stress.cjs'); await build({entryPoints:['src/stress.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const {parsePressureConfig, initialPressure, calculateStress, advancePressure,recordSuccessfulSpawn}=await import(pathToFileURL(out).href);
 const config=parsePressureConfig('stressThreshold .3\nstressSustainTime 80\nstressRestThreshold .25\nstressSpawnThreshold .1\nstressRelaxTime 2\nstressNewBoatUnknown .1\nstressNewBoatSmall .075\nstressNewBoatMedium .05\nstressNewBoatLarge .075\nstressWarning .05\nstressDocksFull .1\ntimeBetweenBoats 3\ntimeSinceLastBoat .5');
 const ship=(size, extra={})=>({size,spawning:false,unloaded:false,docked:false,warning:false,...extra});
 const snapshot=(boats,occupiedDocks=0,totalDocks=6)=>({boats,occupiedDocks,totalDocks});
 assert.ok(Math.abs(calculateStress(config,snapshot([ship(0),ship(1),ship(2,{unloaded:true}),ship(0,{docked:true,warning:true}),ship(1,{spawning:true})]))-(.075+.05+.075*.5+.05+.1))<1e-10);
 assert.equal(calculateStress(config,snapshot([],0,0)),0,'no boats are not counted as all docks full');
 assert.ok(Math.abs(calculateStress(config,snapshot([ship(0,{docked:true})],6,6))-.1)<1e-10,'all docks occupied adds stress');
 let state=initialPressure(config); assert.equal(state.spawnElapsed,.5);
 let d=advancePressure(state,config,snapshot([]),2,3); assert.equal(d.shouldSpawn,false);state=d.state;
 d=advancePressure(state,config,snapshot([]),.5,3); assert.equal(d.shouldSpawn,true); state=recordSuccessfulSpawn(d.state);assert.equal(state.spawnElapsed,0);
 d=advancePressure(state,config,snapshot([ship(0),ship(0),ship(0),ship(0)]),.1,3);assert.equal(d.state.phase,1,'threshold moves normal to sustain');state=d.state;
 d=advancePressure(state,config,snapshot([ship(0)]),.01,3);assert.equal(d.shouldSpawn,true,'sustain attempts immediate spawn below lower threshold regardless of timer');state=d.state;
 d=advancePressure(state,config,snapshot([ship(0),ship(0),ship(0),ship(0)]),24,3);assert.equal(d.state.phase,2,'sustain lasts threshold times sustain');state=d.state;
 d=advancePressure(state,config,snapshot([ship(0)]),.1,3);assert.equal(d.state.phase,3,'low stress initiates relax');state=d.state;
 d=advancePressure(state,config,snapshot([]),1.99,3);assert.equal(d.applyPacing,false);state=d.state;
 d=advancePressure(state,config,snapshot([]),.01,3);assert.equal(d.state.phase,0);assert.equal(d.applyPacing,true);assert.ok(Math.abs(d.state.threshold-.41)<1e-10);
 const s55={phase:3,phaseElapsed:2,spawnElapsed:0,threshold:.55};assert.ok(Math.abs(advancePressure(s55,config,snapshot([]),0,3).state.threshold-.61)<1e-10);
 const s85={...s55,threshold:.85};assert.ok(Math.abs(advancePressure(s85,config,snapshot([]),0,3).state.threshold-.86)<1e-10);
 console.log('PASS: original stress weights, timer, 4-phase progression, adaptive thresholds, score-stage activation');
} finally {await rm(dir,{recursive:true,force:true});}
