// Exercise a shared UI fixture through native/Wasm and the shipped frontend.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const core=path.resolve(process.argv[2]),root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=process.argv[3];
assert(fixture,'Pass a shared fixture name after the compiler checkout');
const entry=`tests/shared/${fixture}/main.dl`;
const expected=await fs.readFile(path.join(root,`tests/shared/${fixture}/expected.txt`),'utf8');
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(core,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(core,'tests/web/allocation_probe.mjs')));
async function verify(bytes,label) {
  const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
  const allocations=observeAllocations(runtime,1024*1024);
  const {instance}=await WebAssembly.instantiate(bytes,runtime);
  try {instance.exports.main();} catch(error) {throw new Error(chunks.join(''),{cause:error});}
  assert.equal(chunks.join(''),expected,label);
  assert.equal(allocations.live,0,label+' retained fixture allocations');
  console.log('PASS shared UI fixture',fixture,label);
}
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-shader-descriptions-'));
try {
  for(const level of ['-O0','-O2']) {
    const output=path.join(temporary,'descriptions.wasm');
    const log=execFileSync(path.join(core,'build/dynlex'),[entry,'--emit-wasm',level,'-o',output],
      {cwd:root,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
    assert.equal(log,'');
    await verify(await fs.readFile(output),'native compiler '+level);
  }
  const graph=JSON.parse(execFileSync(path.join(core,'build/dynlex'),[entry,'--dump-dependencies'],{cwd:root,encoding:'utf8'}));
  assert(graph.complete);
  const sources={};
  for(const filename of new Set([...graph.sources,...graph.configurations])) {
    const relative=path.relative(root,filename);
    const key=relative.startsWith('../')?'lib/'+path.relative(path.join(core,'lib'),filename):relative;
    assert(!key.split('/').includes('..'),'A fixture escaped the UI/compiler source roots');
    sources[key]=await fs.readFile(filename,'utf8');
  }
  const directory=path.join(core,'src/web/ide/public/compiler');
  const factory=(await import(pathToFileURL(path.join(directory,'dynlex_web.js')))).default;
  const compiler=await factory({locateFile:name=>path.join(directory,name)});
  const call=(name,result=null,types=[],values=[])=>compiler.ccall(name,result,types,values);
  call('dynlex_web_init');
  assert.equal(call('dynlex_web_set_import_sources','number',['string'],[JSON.stringify(sources)]),0);
  assert.equal(call('dynlex_web_set_entry_file','number',['string'],[entry]),0);
  assert.equal(call('dynlex_web_compile_and_emit_wasm','number'),0,call('dynlex_web_get_diagnostics_json','string'));
  assert.deepEqual(JSON.parse(call('dynlex_web_get_diagnostics_json','string')).diagnostics,[]);
  await verify(Buffer.from(call('dynlex_web_get_output_wasm_base64','string'),'base64'),'shipped browser compiler');
} finally {await fs.rm(temporary,{recursive:true,force:true});}
