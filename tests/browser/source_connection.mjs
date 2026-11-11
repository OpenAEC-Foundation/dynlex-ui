// Actual language server + actual shared client Wasm, with a recording transport.
// No UI host, browser, window, or duplicated editor policy is involved.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const compilerDirectory=path.join(checkout,'src/web/ide/public/compiler');
const {default:createCompiler}=await import(pathToFileURL(path.join(compilerDirectory,'dynlex_web.js')));
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(compilerDirectory,'runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(checkout,'tests/web/allocation_probe.mjs')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-source-connection-'));
try {
  const module=await createCompiler({locateFile:name=>path.join(compilerDirectory,name)});
  for(const optimization of ['-O0','-O2']) {
    module.ccall('dynlex_web_init');
    const file=path.join(directory,'client.wasm');
    execFileSync(path.join(checkout,'build/dynlex'),['tests/browser/source_connection.dl',
      '--emit-wasm',optimization,'-o',file],{timeout:60000});
    const bytes=await fs.readFile(file),output=[],exchanges=[];
    const runtime=buildRuntimeImports(output,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
    const allocation=observeAllocations(runtime,4*1024*1024);
    const memory=runtime.env.__linear_memory,decoder=new TextDecoder(),encoder=new TextEncoder();
    runtime.env.source_language_exchange=(pointer,count,address,length)=>{
      const payload=JSON.parse(decoder.decode(new Uint8Array(memory.buffer,pointer,count)));
      let response;
      if(payload.operation==='project') {
        assert.equal(module.ccall('dynlex_web_set_import_sources','number',['string'],[JSON.stringify(payload.sources)]),0);
        response='null';
      } else if(payload.operation==='reset') {
        module.ccall('dynlex_web_init');response='null';
      } else {
        assert.equal(payload.operation,'exchange');
        response=module.ccall('dynlex_web_lsp_exchange_json','string',['string'],[JSON.stringify(payload.message)]);
      }
      exchanges.push({payload,response:JSON.parse(response)});
      const encoded=encoder.encode(response),data=runtime.env.malloc(encoded.length);
      new Uint8Array(memory.buffer,data,encoded.length).set(encoded);
      const result=new DataView(memory.buffer);result.setUint32(address,data,true);result.setInt32(length,encoded.length,true);
    };
    const {instance}=await WebAssembly.instantiate(bytes,runtime);
    try {instance.exports.main();} catch(error) {
      const diagnostics=exchanges.flatMap(entry=>Array.isArray(entry.response)?entry.response:[])
        .filter(message=>message.method==='textDocument/publishDiagnostics');
      throw new Error(output.join('')+'\n'+JSON.stringify({diagnostics,recent:exchanges.slice(-5)}),{cause:error});
    }
    assert.equal(output.join(''),'Shared source models preserve imported inference through the real language-server connection.\n');
    assert.equal(allocation.live,0,'The shared source connection retained allocations');
    const messages=exchanges.filter(entry=>entry.payload.operation==='exchange');
    assert.deepEqual(messages.filter(entry=>entry.payload.message.method==='textDocument/didOpen')
      .map(entry=>entry.payload.message.params.textDocument.uri),['file:///workspace/main.dl','file:///workspace/helper.dl']);
    assert.equal(messages.filter(entry=>entry.payload.message.method==='textDocument/didClose').length,0,
      'Viewing imported code closed the main source');
    const hovers=messages.filter(entry=>entry.payload.message.method==='textDocument/hover')
      .map(entry=>entry.response.find(message=>message.id===12 && !message.method)?.result);
    assert.equal(hovers.length,2);
    assert.match(JSON.stringify(hovers[0]),/integer/i,'The imported parameter lost its integer instance');
    assert.match(JSON.stringify(hovers[1]),/a pointer to a byte/i,'The imported parameter retained its preceding main-file instance');
    const changes=messages.filter(entry=>entry.payload.message.method==='textDocument/didChange');
    assert.deepEqual(changes.map(entry=>entry.payload.message.params.textDocument.uri),['file:///workspace/main.dl']);
    console.log('PASS real shared language connection',optimization);
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
