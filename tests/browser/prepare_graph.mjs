// Compile real DynLex stages and expose the current public UI renderer privately.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareScene} from './prepare_scene.mjs';

const core=path.resolve(process.argv[2]),root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[3]);
await fs.mkdir(output,{recursive:true});
await fs.mkdir(path.join(output,'__tests__'),{recursive:true});
execFileSync(process.execPath,['tests/browser/prepare_resources.mjs',core,output],{cwd:root,stdio:'inherit',timeout:120000});
await prepareScene(core,output);
await fs.copyFile(path.join(output,'scene-buffers.json'),path.join(output,'__tests__/scene-buffers.json'));
const shippedCompiler=path.join(core,'src/web/ide/public/compiler');
execFileSync(process.execPath,[path.join(core,'tests/web/shader_uniforms.mjs'),shippedCompiler,
  path.join(output,'__tests__/shader-uniforms.json')],{cwd:root,stdio:'inherit',timeout:60000});
execFileSync(process.execPath,[path.join(core,'tests/web/shader_derivatives.mjs'),shippedCompiler,
  path.join(output,'__tests__/shader-derivatives.json')],{cwd:root,stdio:'inherit',timeout:60000});
for(const name of ['shader_graph_rendering.mjs','shader_fixtures.mjs','rendering.mjs','scene_rendering.mjs','pipeline_rendering.mjs','lighting_rendering.mjs','sampling_rendering.mjs','derivative_rendering.mjs'])
  await fs.copyFile(path.join(root,'tests/browser',name),path.join(output,'__tests__',name));
await fs.copyFile(path.join(root,'tests/browser/shader_resources.html'),path.join(output,'index.html'));
await fs.cp(path.join(root,'platform/browser'),path.join(output,'platform'),{recursive:true});
await fs.copyFile(path.join(core,'web/graphics-backend.js'),path.join(output,'platform/graphics-backend.js'));
const sources={},jobs=[
  {entry:'tests/browser/shader_graph_vertex.dl',kind:'shader',stage:'vertex',output:'graph-vertex'},
  {entry:'tests/browser/shader_graph_post.dl',kind:'shader',stage:'fragment',output:'graph-post'},
  {entry:'tests/browser/shader_graph_pattern.dl',kind:'shader',stage:'fragment',output:'graph-pattern'},
  {entry:'tests/browser/scene_tone.dl',kind:'shader',stage:'fragment',output:'scene-tone'},
  {entry:'tests/browser/scene_lighting.dl',kind:'shader',stage:'fragment',output:'scene-lighting'},
  {entry:'tests/browser/scene_roughness.dl',kind:'shader',stage:'fragment',output:'scene-roughness'},
  {entry:'ui/shaders/environment_dfg.dl',kind:'shader',stage:'fragment',output:'environment-dfg'},
  {entry:'tests/browser/scene_cube.dl',kind:'shader',stage:'fragment',output:'scene-cube'},
  {entry:'tests/browser/scene_sampling_query.dl',kind:'shader',stage:'fragment',output:'sampling-query'},
  {entry:'tests/browser/scene_sampling_data.dl',kind:'wasm',output:'sampling-data.wasm'},
  ...['vertex','fragment'].map(stage=>({entry:'tests/browser/shader_interfaces.dl',kind:'shader',stage,output:'interfaces-'+stage})),
  ...['vertex','fragment'].map(stage=>({entry:'tests/browser/shader_pipelines.dl',kind:'shader',stage,output:'pipelines-'+stage}))
];
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
const request=path.join(output,'graph-request.json');
await fs.writeFile(request,JSON.stringify({sources,jobs}));
execFileSync(process.execPath,[path.join(core,'scripts/compile_project.mjs'),request,output],{cwd:core,stdio:'inherit',timeout:90000});
const artifacts={};
artifacts.derivatives=JSON.parse(await fs.readFile(path.join(output,'__tests__/shader-derivatives.json'),'utf8'));
for(const job of jobs.filter(job=>job.kind==='shader')) artifacts[job.output]={
  webgpu:await fs.readFile(path.join(output,job.output+'.wgsl'),'utf8'),
  webgl:await fs.readFile(path.join(output,job.output+'.glsl'),'utf8'),
  reflection:JSON.parse(await fs.readFile(path.join(output,job.output+'.json'),'utf8'))
};
await fs.writeFile(path.join(output,'graph.json'),JSON.stringify(artifacts));
await fs.copyFile(path.join(root,'tests/shared/scene_tone/reference.json'),path.join(output,'tone-reference.json'));
await fs.copyFile(path.join(root,'tests/shared/scene_lighting/reference.json'),path.join(output,'lighting-reference.json'));
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(core,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(core,'tests/web/allocation_probe.mjs')));
const bytes=await fs.readFile(path.join(output,'sampling-data.wasm')),chunks=[];
const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
const allocations=observeAllocations(runtime,1024*1024);
const {instance}=await WebAssembly.instantiate(bytes,runtime);
try {instance.exports.main();} catch(error) {throw new Error(chunks.join(''),{cause:error});}
assert.equal(allocations.live,0,'The sampling probe retained its reference data');
const data=JSON.parse(chunks.join(''));
assert.equal(data.cube.length,96);assert.equal(data.lookup.length,16);
await fs.writeFile(path.join(output,'sampling-data.json'),JSON.stringify(data));
