import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createServiceCalls} from '../../platform/browser/service-calls.js';

const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(checkout,'tests/web/allocation_probe.mjs')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-ui-service-provider-'));
try {
  for(const level of ['-O0','-O2']) {
    const output=path.join(directory,'provider.wasm');
    execFileSync(path.join(checkout,'build/dynlex'),[path.resolve('tests/browser/service_provider.dl'),'--emit-wasm',level,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),chunks=[],requests=[],cancelled=[],errors=[];
    const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
    const allocation=observeAllocations(runtime,1024*1024),memory=runtime.env.__linear_memory,decoder=new TextDecoder();
    const text=(pointer,count)=>decoder.decode(new Uint8Array(memory.buffer,pointer,count));
    const name=pointer=>{const data=new Uint8Array(memory.buffer);let end=pointer;while(data[end])end++;return text(pointer,end-pointer);};
    const call=createServiceCalls({memory,allocate:count=>runtime.env.malloc(count),
      services:{storage:payload=>({stored:payload.text}),broken:()=>{throw new Error('private provider detail');}},
      report:(service,error)=>errors.push({service,error})});
    runtime.env.ui_call=(surface,service,pointer,count,address,length)=>{
      assert.equal(surface,41);return call(name(service),JSON.parse(text(pointer,count)),address,length);
    };
    runtime.env.ui_request=(surface,service,pointer,count)=>{
      requests.push({surface,service:name(service),payload:JSON.parse(text(pointer,count))});return 7;
    };
    runtime.env.ui_cancel_request=id=>{cancelled.push(id);return Number(id===7);};
    const {instance}=await WebAssembly.instantiate(bytes,runtime);
    instance.exports.main();
    assert.equal(chunks.join(''),'Browser capabilities implement the shared typed service contract.\n');
    assert.deepEqual(requests,[{surface:41,service:'language',payload:{operation:'project'}}]);
    assert.deepEqual(cancelled,[7]);
    assert.equal(errors.length,1);assert.equal(errors[0].service,'broken');
    assert.equal(errors[0].error.message,'private provider detail');
    assert.equal(allocation.live,0,'A browser service retained a transferred result');
    console.log('PASS browser service provider',level);
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
