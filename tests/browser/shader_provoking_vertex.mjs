import assert from 'node:assert/strict';
import {createWebGlPrimitiveDraws} from '../../platform/browser/shader-provoking-webgl.js';

const writes=[],retired=[];
const transfer={allocate:(size,usage)=>({size,usage}),write:(buffer,bytes)=>writes.push([...new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4)]),retire:buffer=>retired.push(buffer)};
const source={indexValues:new Uint32Array([99,7,2,5,3,4,1]),commands:[
  {count:3,instances:2,first:1,indexed:true,pipeline:2,offsets:[16,24]},
  {count:4,instances:1,first:10,indexed:false,pipeline:1,offsets:[0,0]}
]};
const triangles=createWebGlPrimitiveDraws('triangle-list',transfer);
const plan=triangles.prepare(source);
assert.deepEqual(writes,[[2,5,7,11,12,10]]);
assert.deepEqual(plan.map(({first,count,indexed,pipeline,offsets})=>({first,count,indexed,pipeline,offsets})),[
  {first:0,count:3,indexed:true,pipeline:2,offsets:[16,24]},
  {first:3,count:3,indexed:true,pipeline:1,offsets:[0,0]}
]);
assert.equal(triangles.prepare(source),plan,'Unchanged geometry must retain its prepared indices');
assert.equal(writes.length,1);
source.commands=[{count:6,instances:1,first:1,indexed:true,pipeline:2,offsets:[]}];
assert.deepEqual(triangles.prepare(source)[0],{count:6,instances:1,first:0,indexed:true,pipeline:2,offsets:[]});
assert.deepEqual(writes.at(-1),[2,5,7,4,1,3]);
triangles.close();assert.equal(retired.length,1);
const lines=createWebGlPrimitiveDraws('line-list',transfer);
source.commands=[{count:5,instances:1,first:1,indexed:true,pipeline:2,offsets:[]}];
assert.equal(lines.prepare(source)[0].count,4);
assert.deepEqual(writes.at(-1),[2,7,3,5]);
lines.close();
const points=createWebGlPrimitiveDraws('point-list',transfer);
assert.equal(points.prepare(source)[0].count,5);
assert.deepEqual(writes.at(-1),[7,2,5,3,4]);
points.close();
console.log('WebGL primitive lowering preserves first-vertex flat values, winding, ranges, instancing and cached allocations.');
