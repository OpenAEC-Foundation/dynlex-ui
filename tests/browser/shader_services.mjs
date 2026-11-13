import assert from 'node:assert/strict';
import { createGraphicsServices } from '../../platform/browser/graphics-services.js';

const memory={buffer:new ArrayBuffer(1024)};
const surface={},other={},surfaces=new Map([[17,surface],[18,other]]),resources=new Map();
const calls=[],buffers=new Map();let sequence=100,closed=0;
const texture={texture:{destroy(){}},width:5,height:3};
const renderer={
  vertexBuffer(pass,slot,data){buffers.set(`${pass}:${slot}`,data.slice());calls.push(['vertex',pass,slot,[...data]]);},
  indexBuffer(pass,data){calls.push(['index',pass,[...data]]);},
  draws(pass,data){calls.push(['draws',pass,[...data]]);},
  bufferBytes(pass,slot){return buffers.get(`${pass}:${slot}`).byteLength;},
  bufferRecords(pass,slot){return buffers.get(`${pass}:${slot}`).byteLength/8;},
  indexCount(){return 3;},
  uniformBuffer(...args){calls.push(['uniform',...args.slice(0,-1),[...args.at(-1)]]);},
  imageBytes(name,level,layer,bytes){calls.push(['image',name,level,layer,[...bytes]]);},
  render(width,height){calls.push(['render',width,height]);return texture;},
  close(){closed++;}
};
const gpu={backend:'webgpu',async shader(owner,description){assert.equal(owner,surface);calls.push(['create',description]);return renderer;}};
const service=createGraphicsServices({gpu,surfaces,resources,id:()=>++sequence,memory,base:'https://assets.invalid/project/'});
const fetch=globalThis.fetch;
globalThis.fetch=async url=>{
  if(String(url)==='https://assets.invalid/project/vertices.bin')return new Response(new Uint8Array([1,2,3,4,5,6,7,8]));
  if(String(url)==='https://assets.invalid/project/indices.bin')return new Response(new Uint32Array([2,1,0]));
  throw new Error(`Unexpected asset ${url}`);
};
try {
  const source=value=>({webgpu:{kind:'source',value},webgl:{kind:'source',value}});
  const description={operation:'shader',assets:[{kind:'texture',name:'paint'}],output:'output',passes:[{vertex:source('vertex'),fragment:source('fragment'),
    vertexBuffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}],source:'vertices.bin'}],
    indices:'indices.bin',draws:[],uniforms:[],resources:[],glslBindings:[],glslUniforms:[],state:{},color:{},depth:null,topology:'triangle-list'}]};
  const response=await service.request(description,{signal:new AbortController().signal},surface);
  assert.equal(response.passes,1);
  assert.deepEqual(calls[0][1].assets,description.assets);assert.equal(calls[0][1].output,'output');
  assert.deepEqual(calls[1],['vertex',0,0,[1,2,3,4,5,6,7,8]]);
  assert.deepEqual(calls[2],['index',0,[2,1,0]]);
  const imports=service.imports;
  assert.equal(imports.ui_shader_geometry,undefined,'The obsolete four-float geometry ABI must be removed');
  const handle=response.resource;
  new Uint8Array(memory.buffer,16,8).set([8,7,6,5,4,3,2,1]);
  imports.ui_shader_vertex_buffer(17,handle,0,0,16,8);
  assert.deepEqual(calls.at(-1),['vertex',0,0,[8,7,6,5,4,3,2,1]]);
  assert.equal(imports.ui_shader_buffer_bytes(17,handle,0,0),8);
  assert.equal(imports.ui_shader_buffer_records(17,handle,0,0),1);
  new Uint32Array(memory.buffer,32,3).set([0,2,1]);
  imports.ui_shader_index_buffer(17,handle,0,32,3);
  assert.deepEqual(calls.at(-1),['index',0,[0,2,1]]);
  assert.equal(imports.ui_shader_index_count(17,handle,0),3);
  new Uint32Array(memory.buffer,48,6).set([3,2,1,4,5,1]);
  imports.ui_shader_draws(17,handle,0,48,1);
  assert.deepEqual(calls.at(-1),['draws',0,[3,2,1,4,5,1]]);
  new Uint8Array(memory.buffer,96,16).set([1,2,3,4]);
  imports.ui_shader_uniform(17,handle,0,2,3,0,1,4,96,16);
  assert.deepEqual(calls.at(-1),['uniform',0,2,3,0,1,4,[1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0]]);
  new Uint8Array(memory.buffer,160,8).set(new TextEncoder().encode('ink 🌽'));
  imports.ui_shader_image(17,handle,160,8,2,5,96,4);
  assert.deepEqual(calls.at(-1),['image','ink 🌽',2,5,[1,2,3,4]]);
  const output=imports.ui_shader_frame(17,handle,5,3);
  assert.equal(resources.get(output),texture);
  assert.deepEqual(calls.at(-1),['render',5,3]);
  assert.throws(()=>imports.ui_shader_buffer_bytes(18,handle,0,0),/different surface/);
  await assert.rejects(()=>service.request({operation:'release',resource:handle},{signal:new AbortController().signal},other),/different surface/);
  imports.ui_shader_close(17,handle);
  assert.equal(closed,1);assert.equal(resources.has(output),false);assert.equal(service.owns(handle),false);
  assert.throws(()=>imports.ui_shader_index_count(17,handle,0),/Unknown shader/);
  const another=await service.request(description,{signal:new AbortController().signal},surface);
  service.closeSurface(surface);
  assert.equal(service.owns(another.resource),false);assert.equal(closed,2);
} finally {globalThis.fetch=fetch;}
console.log('Shader services transfer raw streams and draw records, load typed assets and enforce surface ownership.');
