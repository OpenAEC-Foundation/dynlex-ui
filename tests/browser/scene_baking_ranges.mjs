import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-baking-ranges-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const cases=[
    {body:'set color to linear UI ink red value green 1.0 blue 1.0',valid:[-1,0,1],invalid:[NaN,Infinity,1e39]},
    {body:'set color to linear UI ink from (UI ink (value as an integer) 0 0)',valid:[0,255],invalid:[-1,256]},
    {body:'set vertex\'s x to value as a 32 bit floating-point number\nappend vertex to vertices\nset mesh to a UI scene mesh taking vertices vertices and indices indices',valid:[0,1],invalid:[NaN,Infinity,1e39]},
    {body:'append vertex to vertices\nloop count from 0 to (value as an integer):\n    append (linear UI ink red 1.0 green 1.0 blue 1.0) to colors\nset mesh to a UI scene mesh taking vertices vertices and indices indices and colors colors',valid:[1],invalid:[0,2]},
    {body:'append vertex to vertices\nloop count from 0 to (value as an integer):\n    append (0 as a 32 bit unsigned integer) to indices\nrecalculate UI mesh normals in vertices using indices',valid:[0,3],invalid:[1,2]},
    {body:'append vertex to vertices\nappend UI mesh triangle 0 0 (value as an integer) to indices\nrecalculate UI mesh normals in vertices using indices',valid:[0],invalid:[-1,1]},
    {body:'append vertex to vertices\nset color to a new linear UI paint\nset color\'s red to value as a 32 bit floating-point number\nappend color to colors\nset mesh to a UI scene mesh taking vertices vertices and indices indices and colors colors',valid:[0,1],invalid:[NaN,Infinity,1e39]}
  ];
  for(const configuration of cases) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/scene_baking.dl')}
import ${path.resolve('ui/scene_normals.dl')}
set value to @intrinsic("call", "host", "value", a 64 bit floating-point number)
set vertices to an empty list of UI mesh vertex
set indices to an empty list of a 32 bit unsigned integer
set colors to an empty list of linear UI paint
set vertex to a new UI mesh vertex
${configuration.body}
free vertices
free indices
free colors
print line "Accepted mesh data"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted mesh data\n');}
      else {assert(failure,`Accepted ${value} in ${configuration.body}`);assert.match(chunks.join(''),/mesh|color/i);}
    }
  }
  console.log('Mesh data rejects incomplete color streams, invalid topology and non-finite vertex or color values at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
