// Reject narrowing, fractional integers and float32 overflow before an upload.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-shader-values-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  const configurations=[
    {kind:'a 64 bit integer',expression:'a UI signed shader value from (value as a 128 bit integer)',
      valid:[-2147483648n,2147483647n],invalid:[-2147483649n,2147483648n,4294967299n]},
    {kind:'a 64 bit integer',expression:'a UI unsigned shader value from (value as a 128 bit integer)',
      valid:[0n,4294967295n],invalid:[-1n,4294967296n,8589934591n]},
    {kind:'a 64 bit floating-point number',expression:'a UI float shader value from value',
      valid:[0,1.25,3.4028234663852886e38],invalid:[NaN,Infinity,-Infinity,3.4028236e38]},
    {kind:'a 64 bit floating-point number',expression:'a UI signed shader vector from [value,0.0]',
      valid:[-2147483648,2147483647],invalid:[NaN,Infinity,1.5,-2147483649,2147483648]},
    {kind:'a 64 bit floating-point number',expression:'a UI unsigned shader vector from [value,0.0]',
      valid:[0,4294967295],invalid:[NaN,-1,1.5,4294967296]}
  ];
  for(const configuration of configurations) for(const optimization of ['-O0','-O2']) {
    await fs.writeFile(source,`import ${path.resolve('ui/shader_values.dl')}
set value to @intrinsic("call", "host", "value", ${configuration.kind})
set input to ${configuration.expression}
require condition (input's rows = 1) reporting "Wrong shader input shape"
print line "Accepted shader value"
`);
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:30000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    for(const [values,accepted] of [[configuration.valid,true],[configuration.invalid,false]]) for(const value of values) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.value=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(accepted) {assert.ifError(failure);assert.equal(chunks.join(''),'Accepted shader value\n');}
      else {assert(failure,`Accepted ${value} as ${configuration.expression}`);assert.match(chunks.join(''),/Shader .* inputs must/);}
    }
  }
  console.log('Shader values reject integer narrowing, fractional inputs and non-finite float32 conversions at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
