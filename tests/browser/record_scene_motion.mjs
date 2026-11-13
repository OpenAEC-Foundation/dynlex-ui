// Explicit reference recording from the preserved, independently authored model.
// Normal tests consume the JSON and never regenerate expected values.
import assert from 'node:assert/strict';
import {writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [core,output,revision]=process.argv.slice(2);
assert(core&&output&&revision,'Pass the core checkout, explicit reference destination and original source revision');
const source=execFileSync('git',['show',`${revision}:web/farm-motion.js`],{cwd:core});
const vector=execFileSync('git',['show',`${revision}:web/vendor/three/three.module.min.js`],{cwd:core});
const vectorCore=execFileSync('git',['show',`${revision}:web/vendor/three/three.core.min.js`],{cwd:core});
const temporary=await mkdtemp(path.join(tmpdir(),'dynlex-motion-reference-'));
const headings=[Math.PI,Math.PI/2,0,-Math.PI/2];
const place=(point,facing)=>({kind:'place',point,facing,heading:headings[facing]});
const target=(point,facing,duration)=>({kind:'target',point,facing,heading:headings[facing],duration});
const advance=seconds=>({kind:'advance',seconds});
const frames=(count,seconds)=>Array.from({length:count},()=>advance(seconds));
try {
  await mkdir(path.join(temporary,'vendor/three'),{recursive:true});
  await writeFile(path.join(temporary,'package.json'),' {"type":"module"}\n');
  await writeFile(path.join(temporary,'farm-motion.js'),source);
  await writeFile(path.join(temporary,'vendor/three/three.module.min.js'),vector);
  await writeFile(path.join(temporary,'vendor/three/three.core.min.js'),vectorCore);
  const {ActorMotion}=await import(pathToFileURL(path.join(temporary,'farm-motion.js')));
  const {Vector3}=await import(pathToFileURL(path.join(temporary,'vendor/three/three.module.min.js')));
  const scenarios=[
    [place([0,0,0],2),target([0,0,1],2,.5),advance(.05),advance(.06),...frames(8,1/60),advance(.2),advance(.5),advance(.5)],
    [place([0,0,0],1),target([1,0,0],1,.5),advance(.2),target([1,.2,1],2,.5),advance(.18),target([2,.2,1],1,.25),...frames(5,.2),advance(1)],
    [place([0,0,0],0),target([0,0,1],0,.5),advance(.12),advance(.2),advance(.3),advance(.5)],
    [place([-2,.5,3],3),target([-3,.9,3],3,.25),advance(0),advance(.08),advance(.08),advance(.16),advance(.5)],
    [place([0,0,0],0),target([0,0,0],3,.5),advance(.01),advance(.1),advance(.5),advance(1),place([4,2,1],1)],
    [place([0,0,0],2),target([0,0,1],2,.5),target([1,0,1],1,.5),target([1,0,0],0,.5),advance(2.5),advance(.5)]
  ];
  const cases=scenarios.map(actions=>{
    const motion=new ActorMotion(new Vector3(),2);
    return actions.map(action=>{
      let active=false;
      if(action.kind==='place') motion.place(new Vector3(...action.point),action.facing);
      else if(action.kind==='target') motion.retarget(new Vector3(...action.point),action.facing,action.duration);
      else active=motion.advance(action.seconds);
      return {...action,expected:{position:motion.position.toArray(),target:motion.target.toArray(),yaw:motion.yaw,heading:motion.heading,
        speed:motion.speed,weight:motion.weight,phase:motion.phase,delay:motion.delay,queued:motion.waypoints.length,active}};
    });
  });
  const header={sourceRevision:revision,sourceSHA256:createHash('sha256').update(source).digest('hex')};
  await writeFile(output,JSON.stringify({...header,cases},null,0)+'\n');
  console.log(`Recorded ${cases.length} independent motion scenarios, ${cases.flat().length} transitions.`);
} finally {await rm(temporary,{recursive:true,force:true});}
