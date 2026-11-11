// The same source-control tests run through the browser's wasm32 ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(checkout,'tests/web/allocation_probe.mjs')));
const cases=['shared/source_queries','shared/source_edits','shared/source_completions','shared/source_workspace','shared/source_theme','shared/source_triggers','shared/source_popup','shared/overlays','shared/overlay_capture','shared/viewports','shared/source_tools','unit/read_only','shared/services'];
const selected=process.argv.slice(3);
assert(selected.every(name=>cases.includes(name)), 'Unknown shared source fixture');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-source-features-'));
try {
  for(const name of selected.length?selected:cases) {
    const source=path.resolve('tests',name,'main.dl');
    const expected=await fs.readFile(path.join(path.dirname(source),'expected.txt'),'utf8');
    for(const optimization of ['-O0','-O2']) {
      const output=path.join(directory,'main.wasm');
      execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
      const bytes=await fs.readFile(output),chunks=[];
      const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      const allocation=observeAllocations(runtime,1024*1024);
      const {instance}=await WebAssembly.instantiate(bytes,runtime);
      instance.exports.main();
      assert.equal(chunks.join(''),expected,`${name} ${optimization}`);
      assert.equal(allocation.live,0,`${name} ${optimization}: retained editor allocations`);
      console.log('PASS wasm source feature',name,optimization);
    }
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
