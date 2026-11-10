// Public draw constructors must reject oversized integers before narrowing them.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-ui-draw-ranges-'));
try {
  const source=path.join(directory,'main.dl');
  await fs.writeFile(source,`import ${path.resolve('ui/shader_types.dl')}
set selected to @intrinsic("call", "host", "range scenario", integer)
set value to (@intrinsic("call", "host", "range value", a 64 bit integer)) as a 128 bit integer
if selected = 5:
    set value to value << 64
set count to value if ((selected = 0) or (selected = 5)), else (3 as a 128 bit integer)
set instances to value if (selected = 1), else (1 as a 128 bit integer)
set first to value if (selected = 2), else (0 as a 128 bit integer)
set vertices to value if (selected = 3), else (0 as a 128 bit integer)
set {instances offset} to value if (selected = 4), else (0 as a 128 bit integer)
set draw to a UI shader draw counting count instanced instances starting at first with vertex offset vertices and instance offset instances offset indexed false
set data to the JSON form of UI shader draw draw
print line the compact JSON form of data
free data
`);
  for(const optimization of ['-O0','-O2']){
    const output=path.join(directory,'main.wasm');
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    const run=async(selected,value)=>{
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env['range scenario']=()=>selected;runtime.env['range value']=()=>value;
      const instance=await WebAssembly.instantiate(module,runtime);
      let error;try{instance.exports.main();}catch(failure){error=failure;}
      return {error,output:chunks.join('')};
    };
    for(let selected=0;selected<5;selected++){
      for(const value of [4294967299n,2147483648n,-1n]){
        const result=await run(selected,value);
        assert(result.error,`Draw field ${selected} narrowed ${value} without rejecting it (${optimization}).`);
        assert.match(result.output,/Shader draw ranges must/);
      }
      for(const value of [0n,1n,2147483647n]){
        const result=await run(selected,value);assert.ifError(result.error);
        const expected=[3,1,0,0,0];expected[selected]=Number(value);
        assert.deepEqual(JSON.parse(result.output),Object.fromEntries(
          ['count','instances','first','vertexOffset','instanceOffset'].map((key,index)=>[key,expected[index]]).concat([['indexed',false]])));
      }
    }
    const result=await run(5,3n);assert(result.error,'A 128-bit draw range was truncated.');
    assert.match(result.output,/Shader draw ranges must/);
    console.log('PASS shader draw ranges',optimization);
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
