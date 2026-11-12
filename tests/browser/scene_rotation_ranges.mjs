import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-rotation-ranges-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const cases=[
    {body:'set rotation to the UI scene rotation from direction (a new vector with x 0.0, y value and z 0.0) to direction (a new vector with x 1.0, y 0.0 and z 0.0)',valid:[-2,1],invalid:[NaN,Infinity,0]},
    {body:'set rotation to a new quaternion with w value, x 0.0, y 0.0 and z 0.0\nset matrix to a UI scene matrix at origin oriented rotation scaled one',valid:[-2,1],invalid:[NaN,Infinity,0]}
  ];
  for(const configuration of cases) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/scene_rotations.dl')}
set value to @intrinsic("call", "host", "value", a 64 bit floating-point number)
set origin to a new vector with x 0.0, y 0.0 and z 0.0
set one to a new vector with x 1.0, y 1.0 and z 1.0
${configuration.body}
print line "Accepted orientation"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted orientation\n');}
      else {assert(failure,`Accepted ${value} in ${configuration.body}`);assert.match(chunks.join(''),/scene/i);}
    }
  }
  console.log('Scene orientations reject zero and non-finite directions or quaternions at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
