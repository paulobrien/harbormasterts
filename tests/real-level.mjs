// HD geometry integration checks. The original IPA is read locally at runtime;
// original level data and artwork are never copied into the repository.
// Run: HARBOR_HD_IPA='/path/to/Harbor Master HD 2.0.1.ipa' node tests/real-level.mjs
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';

const suppliedPath = process.env.HARBOR_HD_IPA || process.argv[2];
const defaultPath = resolve('../upload/Harbor Master HD 2.0.1.ipa');
let levelText, hasOriginalLevel = false;
const originalPath = suppliedPath || defaultPath;
try {
  await access(originalPath);
  const files = unzipSync(new Uint8Array(await readFile(originalPath)), {
    filter: e => e.name.toLowerCase().endsWith('/hmhd0001.lvl'),
  });
  const name = Object.keys(files)[0];
  assert.ok(name, 'HD IPA should contain hmhd0001.lvl');
  levelText = new TextDecoder().decode(files[name]);
  hasOriginalLevel = true;
} catch (error) {
  if (suppliedPath || error?.code !== 'ENOENT') throw error;
  // A small synthetic berth also exercises the tests on clean checkouts.
  levelText = 'mapSize 1024 768\nlandElement\n4\n0 100\n100 100\n100 0\n0 0\ndockElement\n512 434\n0\n0\n1\n1\n0\n';
  console.log('NOTE: HD IPA not present; using synthetic level. Set HARBOR_HD_IPA to test all original docks.');
}

const dir = await mkdtemp(join(tmpdir(), 'harbor-level-test-'));
try {
  let source = await readFile('src/game.ts', 'utf8');
  const marker = '  reset();\n  render();\n  return {';
  assert.ok(source.includes(marker), 'game test seam exists');
  source = source.replace(marker, `  reset();\n  render();\n  (globalThis as any).__realLevelTest = {level, update, reset, spawn, shoreContact, insidePolygon, enableSpawns:()=>{pressure=initialPressure(pressureConfig)}, stopSpawns:()=>{pressure={...pressure,phase:0,threshold:1e9,spawnElapsed:-999999}}, getShips:()=>ships, pushShip:(s:any)=>ships.push(s)};\n  return {`);
  const outfile = join(dir, 'game.cjs');
  await build({stdin:{contents:source,sourcefile:'game.ts',resolveDir:resolve('src'),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createGame} = await import(pathToFileURL(outfile).href);
  const handlers = {};
  const context = new Proxy({}, {get:()=>()=>{},set:()=>true});
  const canvas = {style:{},getContext:()=>context,addEventListener(n,f){handlers[n]=f;},removeEventListener(){},setPointerCapture(){},hasPointerCapture(){return false;},getBoundingClientRect:()=>({left:0,top:0,width:1024,height:768})};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const image = {complete:true,naturalWidth:1024};
  let score = 0, crashed = false;
  const game = createGame(canvas,{background:image,sprites:image,music:new Blob(),sounds:{},levelText},{onScore:n=>score=n,onGameOver:()=>{crashed=true;}});
  game.start();
  const t = globalThis.__realLevelTest;
  const reset = () => { t.reset(); t.stopSpawns(); crashed = false; };
  const tick = seconds => {for(let i=0;i<Math.ceil(seconds*60);i++)t.update(1/60);};
  const event = (id,x,y) => ({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
  const route = (ship, to) => {
    handlers.pointerdown(event(1,ship.x,ship.y));
    handlers.pointermove(event(1,to.x,to.y));
    handlers.pointerup(event(1,to.x,to.y));
  };
  const waterNormal = dock => {
    let nearest, minDistance=Infinity;
    for (const polygon of t.level.land) {
      for (let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
        if(!len)continue;
        const u=Math.max(0,Math.min(1,((dock.x-a.x)*dx+(dock.y-a.y)*dy)/(len*len)));
        const x=a.x+u*dx,y=a.y+u*dy,dist=Math.hypot(dock.x-x,dock.y-y);
        if(dist>=minDistance)continue;
        let nx=-dy/len,ny=dx/len;
        if(t.insidePolygon({x:x+nx*.1,y:y+ny*.1},polygon)){nx=-nx;ny=-ny;}
        minDistance=dist;nearest={nx,ny};
      }
    }
    assert.ok(nearest,'dock has shoreline');
    return nearest;
  };
  if (hasOriginalLevel) assert.equal(t.level.docks.length, 6,'the supplied HD map contains six docks');
  for (let idx=0;idx<t.level.docks.length;idx++) {
    for (const size of [0,1,2]) {
      reset();
      const dock=t.level.docks[idx], {nx,ny}=waterNormal(dock);
      const cargo=[1,2,4][size];
      const ship={id:idx,x:dock.x+nx*65,y:dock.y+ny*65,cargoType:dock.cargo,cargo,size,angle:Math.atan2(-ny,-nx),speed:[40,20,10][size],state:'sailing',path:[],dock:null,unloadTime:0,entered:true};
      t.pushShip(ship);
      route(ship,dock);
      for (let n=0;n<2400 && !crashed && ship.state!=='waiting';n++)t.update(1/60);
      assert.equal(crashed,false,`dock ${idx+1}, boat size ${size}: no crash`);
      assert.equal(ship.state,'waiting',`dock ${idx+1}, boat size ${size}: can dock and unload`);
      assert.equal(score,cargo,`dock ${idx+1}, boat size ${size}: scores all cargo`);
      assert.equal(ship.cargo,0,`dock ${idx+1}, boat size ${size}: unloads all cargo`);
      const start={x:ship.x,y:ship.y};
      route(ship,{x:ship.x+nx*120,y:ship.y+ny*120});
      tick(2);
      const displacement=Math.hypot(ship.x-start.x,ship.y-start.y);
      assert.ok(displacement > [30,20,10][size],`dock ${idx+1}, boat size ${size}: departs into open water`);
      assert.equal(t.level.land.some(p=>t.insidePolygon(ship,p)),false,`dock ${idx+1}, boat size ${size}: stays clear of land on departure`);
      assert.equal(crashed,false,`dock ${idx+1}, boat size ${size}: no crash leaving dock`);
    }
  }
  // Invalid berths never unload cargo: wrong color and occupied docks are not available.
  for (const kind of ['wrong-color','occupied']) {
    reset();
    const dock=t.level.docks[0], {nx,ny}=waterNormal(dock);
    if(kind==='occupied')dock.occupant=999;
    const ship={id:50,x:dock.x+nx*65,y:dock.y+ny*65,cargoType:kind==='wrong-color'?1-dock.cargo:dock.cargo,cargo:1,size:0,angle:Math.atan2(-ny,-nx),speed:40,state:'sailing',path:[],dock:null,unloadTime:0,entered:true};
    t.pushShip(ship); route(ship,dock); tick(5);
    assert.equal(score,0,`${kind} berth must not score cargo`);
    assert.equal(ship.cargo,1,`${kind} berth must not accept cargo`);
    assert.notEqual(ship.state,'docking',`${kind} berth must not dock the ship`);
  }
  // A loaded vessel reflects at each map edge; an empty vessel departs.
  const edges = [['left',2,400,Math.PI],['right',1022,100,0],['top',900,2,-Math.PI/2],['bottom',100,766,Math.PI/2]];
  for(const [name,x,y,angle] of edges){
    for(const cargo of [0,1]){
      reset();
      const ship={id:60,x,y,angle,cargoType:0,cargo,size:0,speed:40,state:'sailing',path:[],dock:null,unloadTime:0,entered:true};
      t.pushShip(ship);tick(cargo?0.2:3);
      assert.equal(t.getShips().includes(ship),Boolean(cargo),`${name}: ${cargo?'loaded ship reflects':'empty ship exits'}`);
      if(cargo) assert.ok(ship.x>=0&&ship.x<=1024&&ship.y>=0&&ship.y<=768,`${name}: reflected ship stays on screen`);
    }
  }
  // Exercise actual spawn selection with the HD shoreline on all four sides.
  // We provide deterministic random values but use the real spawn function,
  // its land checks and initial movement rather than replacing any behavior.
  if(hasOriginalLevel){
    const originalRandom=Math.random;
    try {
      const sides=[['left',0,.5],['right',1,.3],['top',2,.9],['bottom',3,.1]];
      for(const [side,edgeIndex,along] of sides){
        reset();
        const values=[.1,(edgeIndex+.1)/4,along,.1];let i=0;
        Math.random=()=>values[Math.min(i++,values.length-1)];
        assert.equal(t.spawn(),true,`${side}: clear candidate accepted`);
        assert.equal(t.getShips().length,1,`${side}: one boat created`);
        const boat=t.getShips()[0];
        assert.ok(side==='left'?boat.x<0:side==='right'?boat.x>1024:side==='top'?boat.y<0:boat.y>768,`${side}: boat starts offscreen`);
        tick(3);
        assert.equal(boat.entered,true,`${side}: boat enters the screen`);
        assert.equal(t.level.land.some(poly=>t.insidePolygon(boat,poly)),false,`${side}: boat is not spawned in land`);
        assert.equal(crashed,false,`${side}: safe initial entry`);
      }
      // Drive the integrated native pressure state to its first spawn rather
      // than only calling the candidate generator in isolation.
      reset();t.enableSpawns();let sample=0;
      const samples=[.1,.1,.5,.1];Math.random=()=>samples[sample++%samples.length];
      tick(2.4);
      assert.equal(t.getShips().length,0,'HD initial timer waits before first spawn');
      tick(.2);
      assert.equal(t.getShips().length,1,'HD pressure timer creates the first ship');
      reset();let i=0;
      Math.random=()=>{i++;return i===1?.1:(i%2===0?.01:.01);};
      assert.equal(t.spawn(),false,'repeated candidates through upper-left land are rejected');
      assert.equal(t.getShips().length,0,'rejected spawn does not create a boat');
    } finally { Math.random=originalRandom; }
  }
  game.destroy();
  console.log(`PASS: ${t.level.docks.length} ${hasOriginalLevel?'original HD':'synthetic'} dock(s), 3 ship sizes each: drawn approach, unloading, cargo score and outward departure; invalid docks and map edges; four-edge HD spawn clearance and integrated initial pressure timing`);
} finally { await rm(dir,{recursive:true,force:true}); }
