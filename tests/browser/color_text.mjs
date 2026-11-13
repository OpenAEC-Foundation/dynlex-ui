// Invalid external color data must fail before it reaches drawing or shaders.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const core=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(core,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-color-text-'));
try {
  const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
  await fs.writeFile(source,`import ${path.resolve('ui/color_text.dl')}
set text to @intrinsic("call", "host", "color_text", a C string)
set color to UI ink from hexadecimal text
print line formatted "{color's red},{color's green},{color's blue}"
`);
  for(const optimization of ['-O0','-O2']) {
    execFileSync(path.join(core,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    const cases=[['#123','17,34,51'],['#aB09fE','171,9,254'],['',null],['123456',null],['#12',null],
      ['#1234',null],['#12345678',null],['!12345f',null],['#12g',null],['#12-456',null],['#12 456',null],['#１２３',null]];
    for(const [text,expected] of cases) {
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      runtime.env.color_text=()=>{
        const data=new TextEncoder().encode(text+'\0'),pointer=runtime.env.malloc(data.length);
        new Uint8Array(runtime.env.__linear_memory.buffer,pointer,data.length).set(data);
        return pointer;
      };
      const instance=await WebAssembly.instantiate(module,runtime);
      let failure;try{instance.exports.main();}catch(error){failure=error;}
      if(expected===null) {assert(failure,`Accepted ${JSON.stringify(text)}`);assert.match(chunks.join(''),/Hexadecimal UI colors/);}
      else {assert.ifError(failure);assert.equal(chunks.join(''),expected+'\n');}
    }
  }
  console.log('External hexadecimal color text validates length, prefix and digits at both optimizations.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
