// Validate authored model domains before they enter the shared renderer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-model-ranges-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const cases=[
    {body:'set checked to a UI scene transform from (the UI scene matrix for (a UI scene pose at (a new vector with x value, y 0.0 and z 0.0) rotated origin scaled one))',valid:[0,1],invalid:[NaN,Infinity,3.4028236e38]},
    {body:'set checked to a UI scene transform from (the UI scene matrix for (a UI scene pose at origin rotated origin scaled (a new vector with x value, y 1.0 and z 1.0)))',valid:[-1,1,0.5],invalid:[NaN,Infinity,0,2e-40]},
    {body:'set checked to a UI scene transform from (the UI scene matrix for (a UI scene pose at origin rotated (a new vector with x value, y 0.0 and z 0.0) scaled one))',valid:[0,0.5,Math.PI],invalid:[NaN,Infinity]},
    {body:'set checked to a UI scene material with color (UI ink 128 128 128) roughness value metalness 0.0',valid:[0,1],invalid:[NaN,Infinity,-1,1.1]},
    {body:'set checked to UI ink from RGB (value as a 128 bit integer)',valid:[0,16777215],invalid:[-1,16777216]},
    {body:'set material to a UI scene material with color (UI ink 128 128 128) roughness 0.5 metalness 0.0\nset material\'s emission strength to value\nrequire UI scene material material',valid:[0,4],invalid:[NaN,Infinity,1e39,-1]},
    {body:'set checked to a UI scene material with color (UI ink (value as an integer) 128 128) roughness 0.5 metalness 0.0',valid:[0,255],invalid:[-1,256]},
    {body:'set checked to a UI scene model from [(a UI scene group named "root" under -1 at identity), (a UI scene group named "child" under (value as an integer) at identity)]',valid:[-1,0],invalid:[-2,1,2]},
    {body:'set model to a UI scene model from [(a UI scene group named "root" under -1 at identity), (a UI scene group named "child" under (value as an integer) at identity)]\nset checked to the index of UI scene part named "child" under 0 in model',valid:[0],invalid:[-1]},
    {body:'set model to a UI scene model from [(a UI scene group named "root" under -1 at identity), (a UI scene group named "child" under 0 at identity), (a UI scene group named "child" under (value as an integer) at identity)]\nset checked to the index of UI scene part named "child" under 0 in model',valid:[-1],invalid:[0]}
  ];
  for(const configuration of cases) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/scene_models.dl')}
set value to @intrinsic("call", "host", "value", a 64 bit floating-point number)
set origin to a new vector with x 0.0, y 0.0 and z 0.0
set one to a new vector with x 1.0, y 1.0 and z 1.0
set identity to an identity UI scene pose
${configuration.body}
print line "Accepted model"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted model\n');}
      else {assert(failure,`Accepted ${value} in ${configuration.body}`);assert.match(chunks.join(''),/scene|RGB|color/i);}
    }
  }
  console.log('Scene models reject invalid poses, materials, colors, topology and missing or ambiguous named parts at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
