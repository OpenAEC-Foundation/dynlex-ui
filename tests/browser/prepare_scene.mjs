// The browser consumes actual DynLex-produced records and compiler translations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function prepareScene(checkout,output) {
  const core=path.resolve(checkout),root=fileURLToPath(new URL('../../',import.meta.url));
  const sources={},jobs=[
    {entry:'tests/browser/scene_data.dl',kind:'wasm',output:'scene-data.wasm'},
    ...['vertex','fragment'].map(stage=>({entry:'tests/browser/scene_shader.dl',kind:'shader',stage,output:'scene-'+stage}))
  ];
  await fs.mkdir(output,{recursive:true});
  for(const entry of new Set(jobs.map(job=>job.entry))) {
    const graph=JSON.parse(execFileSync(path.join(core,'build/dynlex'),[entry,'--dump-dependencies'],{cwd:root,encoding:'utf8',timeout:30000}));
    assert(graph.complete,'Scene fixture dependencies could not be inspected');
    for(const name of graph.sources) {
      const absolute=path.resolve(root,name),relative=path.relative(root,absolute);
      const key=relative.startsWith('../')?'lib/'+path.relative(path.join(core,'lib'),absolute):relative;
      sources[key]=await fs.readFile(absolute,'utf8');
    }
  }
  const request=path.join(output,'scene-request.json');
  await fs.writeFile(request,JSON.stringify({sources,jobs}));
  try {
    execFileSync(process.execPath,[path.join(core,'scripts/compile_project.mjs'),request,output],{cwd:core,timeout:90000,stdio:'pipe'});
  } catch(error) {throw new Error(error.stderr?.toString()||error.message);}
  const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(pathToFileURL(path.join(core,'src/web/ide/public/compiler/runtimeImports.js')));
  const {observeAllocations}=await import(pathToFileURL(path.join(core,'tests/web/allocation_probe.mjs')));
  const bytes=await fs.readFile(path.join(output,'scene-data.wasm')),chunks=[];
  const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
  const allocation=observeAllocations(runtime,1024*1024);
  const {instance}=await WebAssembly.instantiate(bytes,runtime);
  try {instance.exports.main();} catch(error) {throw new Error(chunks.join(''),{cause:error});}
  assert.equal(allocation.live,0,'Scene fixture retained its mesh or instance buffers');
  const data=JSON.parse(chunks.join('')),stages={};
  for(const stage of ['vertex','fragment']) {
    const prefix=path.join(output,'scene-'+stage);
    stages[stage]={webgpu:await fs.readFile(prefix+'.wgsl','utf8'),webgl:await fs.readFile(prefix+'.glsl','utf8'),reflection:JSON.parse(await fs.readFile(prefix+'.json','utf8'))};
  }
  assert.equal(stages.vertex.reflection.vertexInputs.length,15,'The scene probe must exercise all fifteen attributes');
  assert.deepEqual(stages.vertex.reflection.uniforms.map(item=>item.type),[
    {scalar:'float32',rows:4,columns:4},{scalar:'sint32',rows:1,columns:1}
  ]);
  const artifact=path.join(output,'scene-buffers.json');
  await fs.writeFile(artifact,JSON.stringify({data,stages}));
  return artifact;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  console.log(await prepareScene(process.argv[2],path.resolve(process.argv[3])));
}
