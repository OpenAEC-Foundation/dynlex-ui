import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const core=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const root=fileURLToPath(new URL('../../',import.meta.url)),sources={},jobs=[
  {entry:'tests/browser/shader_sampling.dl',kind:'shader',stage:'fragment',output:'sampling'},
  {entry:'tests/browser/shader_asset_data.dl',kind:'wasm',output:'assets.wasm'}
];
await fs.mkdir(output,{recursive:true});
await fs.copyFile(path.join(core,'web/graphics-backend.js'),path.join(output,'graphics-backend.js'));
for(const {entry} of jobs) {
  const graph=JSON.parse(execFileSync(path.join(core,'build/dynlex'),[entry,'--dump-dependencies'],{cwd:root,encoding:'utf8',timeout:30000}));
  assert(graph.complete);
  for(const absolute of new Set([...graph.sources,...graph.configurations])) {
    const relative=path.relative(root,absolute);
    const key=relative.startsWith('../')?'lib/'+path.relative(path.join(core,'lib'),absolute):relative;
    assert(!key.split('/').includes('..'));
    sources[key]=await fs.readFile(absolute,'utf8');
  }
}
const request=path.join(output,'request.json');
await fs.writeFile(request,JSON.stringify({sources,jobs}));
execFileSync(process.execPath,[path.join(core,'scripts/compile_project.mjs'),request,output],{cwd:core,timeout:90000,stdio:'inherit'});
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(pathToFileURL(path.join(core,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(core,'tests/web/allocation_probe.mjs')));
const bytes=await fs.readFile(path.join(output,'assets.wasm')),chunks=[];
const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
const allocation=observeAllocations(runtime,1024*1024),{instance}=await WebAssembly.instantiate(bytes,runtime);
try {instance.exports.main();} catch(error) {throw new Error(chunks.join(''),{cause:error});}
assert.equal(allocation.live,0,'Shader asset declarations leaked allocations');
await fs.writeFile(path.join(output,'resources.json'),JSON.stringify({assets:JSON.parse(chunks.join('')),
  webgpu:await fs.readFile(path.join(output,'sampling.wgsl'),'utf8'),
  webgl:await fs.readFile(path.join(output,'sampling.glsl'),'utf8'),
  reflection:JSON.parse(await fs.readFile(path.join(output,'sampling.json'),'utf8'))}));
