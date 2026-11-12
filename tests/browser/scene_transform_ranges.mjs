// Model matrices and normals are authored data, so reject invalid domains explicitly.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-transform-ranges-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const cases=[
    {prepare:'store (value as a 32 bit floating-point number) into matrix at 0',valid:[1,-1,0.5],invalid:[NaN,Infinity,0,2e-40]},
    {prepare:'store (value as a 32 bit floating-point number) into matrix at 3',valid:[0],invalid:[NaN,Infinity,0.1]},
    {prepare:'store (value as a 32 bit floating-point number) into matrix at 15',valid:[1],invalid:[NaN,Infinity,0,2]},
    {prepare:'store (value as a 32 bit floating-point number) into matrix at 12',valid:[0,1,-10],invalid:[NaN,Infinity,-Infinity]},
    {prepare:'',normal:true,valid:[1,-1,0.5],invalid:[NaN,Infinity,0]}
  ];
  for(const configuration of cases) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/scene_transforms.dl')}
set value to @intrinsic("call", "host", "value", a 64 bit floating-point number)
set matrix to an identity graphics matrix
${configuration.prepare}
set transform to a UI scene transform from matrix
${configuration.normal?'set normal to the UI scene normal of (a new vector with x value, y 0.0 and z 0.0) through transform':''}
print line "Accepted transform"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted transform\n');}
      else {assert(failure,`Accepted ${value} in ${configuration.prepare || 'normal'}`);assert.match(chunks.join(''),/Scene .* must|Scene .* require/);}
    }
  }
  console.log('Scene transforms reject projective, singular and non-finite matrices, unrepresentable inverses and zero normals at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
