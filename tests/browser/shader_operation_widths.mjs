// Wide public integers cross the provider's fixed-width ABI without changing it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-ui-shader-widths-'));
try {
  const source=path.join(directory,'main.dl');
  const template=`import ${path.resolve('platform/browser/shaders.dl')}
set driver to a new UI driver
set driver's shader operations to the browser UI shader operations
set view to a new UI view
set view's driver to the address of driver
set view's window to 9 as a pointer
set context to (@intrinsic("call", "host", "opaque view", a pointer, the address of view)) as a pointer to UI view
set shader to 777 as a pointer
set pass to (@intrinsic("call", "host", "argument", a 64 bit integer, 0)) as a TESTWIDTH bit integer
set slot to (@intrinsic("call", "host", "argument", a 64 bit integer, 1)) as a TESTWIDTH bit integer
set size to (@intrinsic("call", "host", "argument", a 64 bit integer, 2)) as a TESTWIDTH bit integer
set width to (@intrinsic("call", "host", "argument", a 64 bit integer, 3)) as a TESTWIDTH bit integer
set height to (@intrinsic("call", "host", "argument", a 64 bit integer, 4)) as a TESTWIDTH bit integer
set {index count} to (@intrinsic("call", "host", "argument", a 64 bit integer, 5)) as a TESTWIDTH bit integer
set {draw count} to (@intrinsic("call", "host", "argument", a 64 bit integer, 6)) as a TESTWIDTH bit integer
set vertices to [1.0,2.0] as a 32 bit floating-point number array of 2 items
set indices to [0,1,2] as a 32 bit unsigned integer array of 3 items
set draws to [a UI shader draw counting 3 instanced 1 starting at 0 with vertex offset 0 and instance offset 0 indexed false]
set UI shader shader pass pass in context vertex buffer slot from ((vertices + 0) as a pointer) spanning size bytes
set UI shader shader image "paint" in context level pass layer slot from ((vertices + 0) as a pointer) spanning size bytes
set UI shader shader pass pass in context to indices (indices + 0) counting index count
set UI shader shader pass pass in context to draws (draws + 0) counting draw count
require condition ((the byte count of UI shader shader pass pass buffer slot in context) = 48) reporting "Wrong byte count."
require condition ((the record count of UI shader shader pass pass buffer slot in context) = 3) reporting "Wrong record count."
require condition ((the index count of UI shader shader pass pass in context) = 6) reporting "Wrong index count."
set image to a UI texture from shader shader sized width by height in context
require condition (image's resource = (100 as a pointer)) reporting "Wrong texture resource."
set UI shader shader pass pass in context enabled false
set UI shader shader pass pass in context enabled true
close UI shader shader in context
print line "Shader provider ABI retained."
`;
  for(const bits of [32,64,128]){
    await fs.writeFile(source,template.replaceAll('TESTWIDTH',String(bits)));
    for(const optimization of ['-O0','-O2']){
    const output=path.join(directory,'main.wasm');
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    const run=async(values)=>{
    const chunks=[],calls=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
    const record=(kind,args)=>{calls.push({kind,args});};
    Object.assign(runtime.env,{
      'opaque view':pointer=>pointer,
      argument:index=>values[index],
      ui_shader_vertex_buffer:(surface,shader,pass,slot,pointer,count)=>record('vertices',[surface,shader,pass,slot,count]),
      ui_shader_image:(surface,shader,name,length,level,layer,pointer,count)=>record('image',[surface,shader,length,level,layer,count]),
      ui_shader_index_buffer:(surface,shader,pass,pointer,count)=>record('indices',[surface,shader,pass,count]),
      ui_shader_draws:(surface,shader,pass,pointer,count)=>record('draws',[surface,shader,pass,count]),
      ui_shader_pass_enabled:(...args)=>record('pass enabled',args),
      ui_shader_buffer_bytes:(...args)=>{record('bytes',args);return 48;},
      ui_shader_buffer_records:(...args)=>{record('records',args);return 3;},
      ui_shader_index_count:(...args)=>{record('index count',args);return 6;},
      ui_shader_uniform:()=>assert.fail('Unexpected uniform upload'),
      ui_shader_frame:(surface,shader,width,height)=>{record('frame',[surface,shader,width,height]);return 100;},
      ui_shader_close:(...args)=>record('close',args)
    });
    const instance=await WebAssembly.instantiate(module,runtime);
    let error;try{instance.exports.main();}catch(failure){error=failure;}
    return {error,output:chunks.join(''),calls};
    };
    const values=[2n,3n,8n,40n,20n,3n,1n],result=await run(values);
    assert.ifError(result.error);
    assert.equal(result.output,'Shader provider ABI retained.\n');
    assert.deepEqual(result.calls,[
      {kind:'vertices',args:[9,777,2,3,8]},{kind:'image',args:[9,777,5,2,3,8]},{kind:'indices',args:[9,777,2,3]},
      {kind:'draws',args:[9,777,2,1]},{kind:'bytes',args:[9,777,2,3]},
      {kind:'records',args:[9,777,2,3]},{kind:'index count',args:[9,777,2]},
      {kind:'frame',args:[9,777,40,20]},{kind:'pass enabled',args:[9,777,2,0]},
      {kind:'pass enabled',args:[9,777,2,1]},{kind:'close',args:[9,777]}
    ]);
    // Earlier valid operations may run, but the rejected operation must not reach its provider.
    for(let field=0;field<values.length;field++){
      for(const value of bits===32?[-1n]:[-1n,2147483648n,4294967299n]){
        const invalid=[...values];invalid[field]=value;
        const rejected=await run(invalid);
        assert(rejected.error,`Field ${field} accepted ${value} at width ${bits}.`);
        assert.match(rejected.output,/UI operation integers must be between/);
        assert.equal(rejected.calls.length,[0,0,0,7,7,2,3][field]);
      }
    }
    for(const field of [3,4]){
      const invalid=[...values];invalid[field]=0n;
      const rejected=await run(invalid);
      assert(rejected.error,'A zero texture dimension was accepted.');
      assert.match(rejected.output,/Shader texture dimensions must be positive/);
      assert.equal(rejected.calls.length,7);
    }
    console.log('PASS shader provider integer widths',bits,optimization);
    }
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
