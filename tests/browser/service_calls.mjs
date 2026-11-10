import assert from 'node:assert/strict';
import {createServiceCalls} from '../../platform/browser/service-calls.js';
import {createWebServices} from '../../platform/browser/web-services.js';
const memory=new WebAssembly.Memory({initial:1}),errors=[],allocations=[];
const services=createWebServices(new URL('https://example.test/'));
const call=createServiceCalls({memory,allocate:count=>{allocations.push(count);return 100;},
  services:{clock:services.clock,echo:data=>data,broken:()=>{throw new Error('private backend detail');},
    missing:()=>undefined,async:()=>Promise.resolve(null)},report:(name,error)=>errors.push({name,error})});
const read=()=>{const view=new DataView(memory.buffer);return JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,view.getUint32(0,true),view.getInt32(4,true))));};
assert.equal(call('echo',{source:'é😀',saved:true},0,4),0);
assert.deepEqual(read(),{source:'é😀',saved:true});
assert.equal(allocations.at(-1),new TextEncoder().encode(JSON.stringify(read())).length+1);
assert.equal(call('clock',null,0,4),0);const stamp=read().milliseconds;
assert(Number.isSafeInteger(stamp)&&Math.abs(Date.now()-stamp)<1000);
for(const name of ['broken','missing','unknown','async']) {
  const allocated=allocations.length;
  assert.equal(call(name,null,0,4),1);
  assert.equal(new DataView(memory.buffer).getUint32(0,true),0);
  assert.equal(new DataView(memory.buffer).getInt32(4,true),0);
  assert.equal(allocations.length,allocated,'A failed call allocated an unreadable reply');
}
assert.equal(errors[0].error.message,'private backend detail');
assert.equal(errors.length,4);
console.log('Immediate platform calls preserve UTF-8 JSON, exact timestamps and explicit errors without exposing provider details.');
