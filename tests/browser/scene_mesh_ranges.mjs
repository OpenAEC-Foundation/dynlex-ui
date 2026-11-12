// Exercise caller-controlled geometry domains through the actual wasm ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-mesh-ranges-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const cases=[
    {expression:'a UI plane mesh with (value as an integer) by 1 segments',valid:[1,3],invalid:[0,-1]},
    {expression:'a UI box mesh with 1 by 1 by (value as an integer) segments',valid:[1,5],invalid:[0,-1]},
    {expression:'a UI sphere mesh with (value as an integer) slices and 2 stacks',valid:[3,10],invalid:[0,2]},
    {expression:'a UI sphere mesh with 3 slices and (value as an integer) stacks',valid:[2,8],invalid:[0,1]},
    {expression:'a UI cylinder mesh with top value bottom 1.0 height 1.0 around 3 sides capped true',valid:[0,1,2],invalid:[NaN,Infinity,-1,3.4028236e38]},
    {expression:'a UI cylinder mesh with top 1.0 bottom 1.0 height value around 3 sides capped true',valid:[0.1,1,2],invalid:[NaN,Infinity,0,-1,Number.MIN_VALUE]},
    {expression:'a UI torus mesh with radius 1.0 tube value around 3 slices and 3 sides swept through 180.0 degrees',valid:[0.1,0.5],invalid:[NaN,Infinity,0,-1,1,2]},
    {expression:'a UI torus mesh with radius 1.0 tube 0.1 around 3 slices and 3 sides swept through value degrees',valid:[180,360],invalid:[NaN,Infinity,0,-1,361]},
    {expression:'a UI ring mesh with inner value outer 1.0 around 3 sides',valid:[0,0.5],invalid:[NaN,Infinity,-1,1,2]},
    {expression:'a UI convex prism mesh from [(a UI point at 0.0 and 0.0), (a UI point at 1.0 and 0.0), (a UI point at 1.0 and 1.0), (a UI point at 0.0 and 1.0)] with depth value',valid:[0.1,1],invalid:[NaN,Infinity,0,-1,Number.MIN_VALUE]},
    {expression:'a UI convex prism mesh from [(a UI point at 0.0 and 0.0), (a UI point at 1.0 and 0.0), (a UI point at 1.0 and value), (a UI point at 0.0 and 1.0)] with depth 1.0',valid:[0.5,1],invalid:[NaN,Infinity,0,-1]}
  ];
  for(const configuration of cases) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/scene_surfaces.dl')}
import ${path.resolve('ui/scene_round_meshes.dl')}
import ${path.resolve('ui/scene_solids.dl')}
set value to @intrinsic("call", "host", "value", a 64 bit floating-point number)
set mesh to ${configuration.expression}
require condition ((the length of mesh's indices) > 0) reporting "Empty geometry"
print line "Accepted mesh"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted mesh\n');}
      else {assert(failure,`Accepted ${value} as ${configuration.expression}`);assert.match(chunks.join(''),/mesh|meshes/);}
    }
  }
  console.log('Scene meshes reject invalid subdivisions, radii, arcs and unrepresentable components at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
