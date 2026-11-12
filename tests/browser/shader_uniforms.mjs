import assert from 'node:assert/strict';
import { shaderUniformLayout, createShaderUniforms } from '../../platform/browser/shader-uniforms.js';

assert.deepEqual(shaderUniformLayout({scalar:'float32',rows:3,columns:2}),{scalar:0,rows:3,columns:2,bytes:48});
for(const type of [
  {scalar:'float64',rows:1,columns:1}, {scalar:'float32',rows:0,columns:3},
  {scalar:'float32',rows:1,columns:5}, {scalar:'sint32',rows:2,columns:2},
  {scalar:'float32',rows:2,columns:1}
]) assert.throws(()=>shaderUniformLayout(type));
const writes=[],retired=[];
const bindings=[
  {name:'camera',group:2,binding:4,type:{scalar:'float32',rows:4,columns:4}},
  {name:'flags',group:0,binding:1,type:{scalar:'uint32',rows:1,columns:3}},
  {name:'optimizedOut',group:0,binding:2,type:{scalar:'sint32',rows:1,columns:1}}
];
const uniforms=createShaderUniforms(bindings,{
  allocate(description,bytes) {return description.name==='optimizedOut'?null:{name:description.name,bytes};},
  write(buffer,bytes) {writes.push({buffer,data:bytes.slice()});},
  retire(buffer) {retired.push(buffer.name);}
});
assert.equal(uniforms.bindings[0].buffer.bytes,64);
assert.equal(uniforms.bindings[1].buffer.bytes,16);
assert.throws(()=>uniforms.requireReady(),/camera/);
const matrix=new Float32Array(Array.from({length:16},(_,index)=>index+0.5));
uniforms.upload(2,4,0,4,4,new Uint8Array(matrix.buffer));
matrix.fill(99);
assert.equal(new Float32Array(writes[0].data.buffer)[5],5.5);
assert.throws(()=>uniforms.requireReady(),/flags/);
uniforms.upload(0,1,2,1,3,new Uint8Array(new Uint32Array([4294967295,0,2147483648,0]).buffer));
uniforms.upload(0,2,1,1,1,new Uint8Array(16));
uniforms.requireReady();
assert.equal(writes.length,2);
assert.throws(()=>uniforms.upload(2,4,0,3,4,new Uint8Array(48)),/type/);
assert.throws(()=>uniforms.upload(0,1,2,1,3,new Uint8Array(12)),/bytes/);
assert.throws(()=>uniforms.upload(0,99,0,1,1,new Uint8Array(16)),/Unknown/);
uniforms.close();
assert.deepEqual(retired,['camera','flags']);
console.log('Typed uniforms retain reflected shapes, raw bytes, readiness and resource ownership.');
