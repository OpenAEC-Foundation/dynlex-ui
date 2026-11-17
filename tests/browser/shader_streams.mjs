import assert from 'node:assert/strict';
import {createWebGlPrimitiveDraws} from '../../platform/browser/shader-provoking-webgl.js';
import { createShaderStream, shaderVertexLayouts, shaderBufferRecords, packShaderDraws,
  validateShaderDraws, createShaderGeometry } from '../../platform/browser/shader-streams.js';

let sequence = 0;
const allocations = [], writes = [], retired = [];
const transfer = {
  allocate(size, usage) { const buffer = { id: ++sequence, size, usage }; allocations.push(buffer); return buffer; },
  write(buffer, bytes) { writes.push({ buffer, bytes: [...bytes] }); },
  retire(buffer) { retired.push(buffer); }
};
const stream = createShaderStream(transfer, 'vertex');
stream.replace(new Uint8Array([1,2,3,4,5,6,7,8]));
const first = stream.buffer;
stream.replace(new Uint8Array([9,10,11,12]));
assert.equal(stream.buffer, first, 'Updating a stream must reuse its allocation when capacity is sufficient');
assert.equal(stream.byteLength, 4, 'Shrinking an upload must change its logical range');
assert.equal(allocations.length, 1);
assert.deepEqual(writes.at(-1).bytes, [9,10,11,12]);
stream.replace(new Uint8Array(20));
assert.notEqual(stream.buffer, first);
assert.deepEqual(retired, [first], 'Growing a stream must retire the preceding resource exactly once');
const grown = stream.buffer;
stream.replace(new Uint8Array());
assert.equal(stream.byteLength, 0);
assert.equal(stream.buffer, grown, 'Empty uploads must preserve reusable capacity');
assert.throws(() => stream.replace(new Uint8Array(3)), /four-byte/);
stream.close();
assert.deepEqual(retired, [first,grown]);
assert.throws(() => stream.replace(new Uint8Array(4)), /closed/);

const layouts = shaderVertexLayouts([
  { arrayStride:16, stepMode:'vertex', attributes:[{ shaderLocation:0, offset:0, format:'float32x2' },
    { shaderLocation:1, offset:8, format:'sint32x2' }] },
  { arrayStride:24, stepMode:'instance', attributes:[{ shaderLocation:2, offset:0, format:'float32x2' },
    { shaderLocation:3, offset:8, format:'float32x3' },{ shaderLocation:4, offset:20, format:'uint32' }] }
]);
assert.equal(shaderBufferRecords(layouts[0], 31), 1);
assert.equal(shaderBufferRecords(layouts[0], 32), 2);
const partial = shaderVertexLayouts([{ arrayStride:16, stepMode:'vertex',
  attributes:[{ shaderLocation:0, offset:0, format:'float32x2' }] }]);
assert.equal(shaderBufferRecords(partial[0], 24), 2, 'The final record does not require trailing stride padding');
assert.throws(() => shaderVertexLayouts([{ arrayStride:12, stepMode:'vertex',
  attributes:[{ shaderLocation:0, offset:8, format:'float32x2' }] }]), /stride/);
assert.throws(() => shaderVertexLayouts([{ arrayStride:16, stepMode:'vertex',
  attributes:[{ shaderLocation:0, offset:0, format:'float32x2' },{ shaderLocation:0, offset:8, format:'float32x2' }] }]), /location/);
const draw = (changes={}) => ({ count:3, instances:2, first:1, vertexOffset:1, instanceOffset:1, indexed:true, pipeline:0, ...changes });
const words = packShaderDraws([draw()]);
assert.deepEqual([...words], [3,2,1,1,1,1,0]);
const indices = new Uint32Array([99,0,1,2,99]);
const plan = validateShaderDraws(3,layouts, [64,72], indices, words);
assert.equal(plan.length,1);
assert.deepEqual(plan[0].offsets,[16,24], 'Offsets select buffer records; builtin IDs remain local to the draw on every backend');
assert.equal(plan[0].first,1);
assert.equal(plan[0].indexed,true);
assert.equal(plan[0].pipeline,0);
const selected=validateShaderDraws(3,layouts,[64,72],indices,packShaderDraws([draw({pipeline:2})]));
assert.equal(selected[0].pipeline,2);
assert.throws(()=>validateShaderDraws(3,layouts,[64,72],indices,packShaderDraws([draw({pipeline:3})])),/pipeline/);
assert.throws(()=>validateShaderDraws(3,layouts,[0,0],new Uint32Array(),packShaderDraws([draw({pipeline:3,count:0})])),/pipeline/);
assert.throws(()=>packShaderDraws([draw({pipeline:-1})]),/pipeline/);
assert.throws(() => validateShaderDraws(3,layouts,[48,72],indices,words), /vertex/);
assert.throws(() => validateShaderDraws(3,layouts,[64,48],indices,words), /instance/);
assert.throws(() => validateShaderDraws(3,layouts,[64,72],indices,packShaderDraws([draw({first:4})])), /index/);
assert.throws(() => validateShaderDraws(3,layouts,[64,72],indices,new Uint32Array([1,1])), /seven/);
assert.throws(() => packShaderDraws([draw({ instances:-1 })]), /instances/);
assert.equal(validateShaderDraws(3,layouts,[0,0],new Uint32Array(),packShaderDraws([draw({count:0})])).length,0);
const nonindexed = validateShaderDraws(3,layouts,[80,72],null,packShaderDraws([draw({indexed:false,pipeline:0,count:2,first:2})]));
assert.deepEqual(nonindexed[0].offsets,[16,24]);
const geometry=createShaderGeometry({ vertexBuffers:[
  { arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}] },
  { arrayStride:24,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x4'}] }
],draws:[],pipelines:[{}, {}, {}] },transfer);
assert.deepEqual(geometry.commands,[]);
geometry.vertexBuffer(0,new Float32Array(16));
geometry.vertexBuffer(1,new Float32Array(18));
geometry.indexBuffer(indices);
geometry.draws(words);
const cached=geometry.commands;
assert.equal(geometry.commands,cached);
const primitiveWrites=[];
const primitives=createWebGlPrimitiveDraws('triangle-list',{
  allocate:(size,usage)=>({size,usage}),write:(buffer,bytes)=>primitiveWrites.push(bytes.byteLength),retire:()=>{}
});
const primitivePlan=primitives.prepare(geometry);
for(let frame=0;frame<20;frame++) {
  geometry.vertexBuffer(1,new Float32Array(18).fill(frame));
  geometry.draws(words.slice());
  assert.equal(geometry.commands,cached,'Identical draw records must retain their validated commands');
  assert.equal(primitives.prepare(geometry),primitivePlan,'Animation must retain its WebGL primitive index plan');
}
assert.equal(primitiveWrites.length,1,'Animating instance data re-uploaded immutable WebGL indices');
primitives.close();
geometry.vertexBuffer(0,new Float32Array(16).fill(0.25));
assert.equal(geometry.commands,cached,'Changing buffer contents without changing their range must preserve draw validation');
assert.equal(geometry.bufferRecords(0),4);
assert.equal(geometry.indexCount,5);
indices[2]=999;
assert.equal(geometry.commands,cached,'Uploading indices must snapshot the caller data before it is freed or reused');
geometry.vertexBuffer(1,new Float32Array(12));
geometry.draws(words.slice());
assert.throws(()=>geometry.commands,/instance/);
geometry.vertexBuffer(1,new Float32Array(18));
assert.equal(geometry.commands.length,1);
geometry.close();
assert.throws(()=>geometry.draws(words),/closed/);
console.log('Typed shader streams reuse buffers, preserve ranges and validate indexed/instanced draw bounds.');
