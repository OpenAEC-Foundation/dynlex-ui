// Camera projection has a matrix contract, even though scalar/vector multiply exists.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const core=path.resolve(process.argv[2]);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-scene-shader-ranges-'));
const helper=await fs.readFile('ui/scene_shader.dl','utf8');
const f32='@intrinsic("type", "float", 32)';
const cases=[
  {kind:f32,accepted:false},
  {kind:`@intrinsic("vector", 4, ${f32})`,accepted:false},
  {kind:`@intrinsic("matrix", 3, 3, ${f32})`,accepted:false},
  {kind:`@intrinsic("matrix", 4, 4, ${f32})`,accepted:true}
];
const program=kind=>`import ui/scene_shader.dl
set camera to the shader uniform named "camera" at binding 0 as (${kind})
set point to a new vector with x 1.0, y 2.0 and z 3.0
set clip to the UI scene shader clip position of point through camera
@intrinsic("shader output", clip)
`;
try {
  const entry=path.join(directory,'main.dl'),output=path.join(directory,'main.spv');
  const local=path.join(directory,'ui');await fs.mkdir(local);
  await fs.writeFile(path.join(local,'scene_shader.dl'),helper);
  for(const optimization of ['-O0','-O2']) for(const {kind,accepted} of cases) {
    await fs.writeFile(entry,program(kind));
    const result=spawnSync(path.join(core,'build/dynlex'),[entry,'--emit-spirv','--shader-stage=vertex',optimization,'-o',output],{encoding:'utf8',timeout:30000});
    assert.ifError(result.error);
    if(accepted) {assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');}
    else {assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/No overload matches call 'the UI scene shader clip position/);}
  }
  const factory=(await import(pathToFileURL(path.join(core,'src/web/ide/public/compiler/dynlex_web.js')))).default;
  const compiler=await factory({locateFile:name=>path.join(core,'src/web/ide/public/compiler',name)});
  const call=(name,result=null,types=[],values=[])=>compiler.ccall(name,result,types,values);
  call('dynlex_web_init');
  for(const {kind,accepted} of cases) {
    assert.equal(call('dynlex_web_set_import_sources','number',['string'],[JSON.stringify({'main.dl':program(kind),'ui/scene_shader.dl':helper})]),0);
    assert.equal(call('dynlex_web_set_entry_file','number',['string'],['main.dl']),0);
    const status=call('dynlex_web_compile_and_emit_shader_spirv','number',['string'],['vertex']);
    const diagnostics=call('dynlex_web_get_diagnostics_json','string');
    if(accepted) assert.equal(status,0,diagnostics);
    else {assert.notEqual(status,0);assert.match(diagnostics,/No overload matches call 'the UI scene shader clip position/);}
  }
  console.log('Scene projection accepts float32 4x4 cameras and rejects scalar, vector and other matrix shapes.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
