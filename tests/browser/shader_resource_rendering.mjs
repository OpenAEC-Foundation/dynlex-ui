import {createShaderAssets} from '../../platform/browser/shader-assets.js';
import {webGpuShaderAssetDriver} from '../../platform/browser/shader-assets-webgpu.js';
import {webGlShaderAssetDriver} from '../../platform/browser/shader-assets-webgl.js';
import {createWebGlProgram} from '/.cache/shader-resources-probe/graphics-backend.js';

const vertexWgsl=`@vertex fn main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let points=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(points[index],0,1);
}`;
const vertexGlsl=`#version 300 es
const vec2 points[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
void main(){gl_Position=vec4(points[gl_VertexID],0,1);}`;

async function webgpu(fixture) {
  const adapter=await navigator.gpu.requestAdapter();
  if(adapter===null) throw new Error('Resource tests require the selected WebGPU adapter');
  const device=await adapter.requestDevice(),errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const assets=createShaderAssets(fixture.assets,webGpuShaderAssetDriver(device,texture=>texture.destroy()));
  assets.resize(8,8);
  const pipeline=await device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:device.createShaderModule({code:vertexWgsl}),entryPoint:'main'},
    fragment:{module:device.createShaderModule({code:fixture.webgpu}),entryPoint:'main',targets:[{format:'rgba8unorm'}]}});
  const output=device.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const readback=device.createBuffer({size:2048,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const uniforms=new Map(fixture.reflection.uniforms.map(uniform=>[uniform.name,
    {uniform,buffer:device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}]));
  const entries=[...uniforms.values()].map(({uniform,buffer})=>({binding:uniform.binding,resource:{buffer}}));
  for(const resource of fixture.reflection.resources) entries.push({binding:resource.binding,
    resource:resource.kind==='texture'?assets.image(resource.name).storage.createView({dimension:resource.dimension}):assets.sampler(resource.name).storage});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
  const depthPipeline=await device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:device.createShaderModule({code:`@vertex fn main(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
      let p=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(1,1),vec2f(0,-1),vec2f(1,1),vec2f(0,1));return vec4f(p[i],0.75,1);
    }`}),entryPoint:'main'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
  const encoder=device.createCommandEncoder(),depthPass=encoder.beginRenderPass({colorAttachments:[],
    depthStencilAttachment:{view:assets.image('shadow').storage.createView(),depthClearValue:0.25,depthLoadOp:'clear',depthStoreOp:'store'}});
  depthPass.setPipeline(depthPipeline);depthPass.draw(6);depthPass.end();device.queue.submit([encoder.finish()]);
  return {assets,
    async frame(values) {
      for(const [name,value] of Object.entries(values)) device.queue.writeBuffer(uniforms.get(name).buffer,0,new Float32Array([...value,...new Array(4-value.length).fill(0)]));
      const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
      encoder.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow:256},[8,8]);
      device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
      const pixel=[...new Uint8Array(readback.getMappedRange()).slice(0,4)];readback.unmap();
      if(errors.length) throw new Error(errors.join('\n'));
      return pixel;
    },
    close() {for(const {buffer} of uniforms.values()) buffer.destroy();readback.destroy();output.destroy();assets.close();device.destroy();}
  };
}

async function webgl(fixture) {
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
  const gl=canvas.getContext('webgl2',{antialias:false});
  if(gl===null) throw new Error('Resource tests require WebGL2');
  const assets=createShaderAssets(fixture.assets,webGlShaderAssetDriver(gl));assets.resize(8,8);
  const program=createWebGlProgram(gl,vertexGlsl,fixture.webgl),array=gl.createVertexArray();
  gl.useProgram(program);gl.bindVertexArray(array);
  const uniforms=new Map();
  for(let block=0;block<gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS);block++) {
    const [index]=gl.getActiveUniformBlockParameter(program,block,gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES);
    const name=gl.getActiveUniform(program,index).name;
    const uniform=fixture.reflection.uniforms.find(value=>name.includes(`_group_${value.group}_binding_${value.binding}_`));
    if(!uniform) throw new Error('A sampled shader uniform block has no reflection');
    const buffer=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,16,gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(program,block,block);gl.bindBufferBase(gl.UNIFORM_BUFFER,block,buffer);
    uniforms.set(uniform.name,{buffer,slot:block});
  }
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,assets.image('shadow').storage.handle,0);
  gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Depth resource framebuffer is incomplete');
  gl.depthMask(true);gl.clearDepth(0.25);gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);gl.scissor(2,0,2,4);gl.clearDepth(0.75);gl.clear(gl.DEPTH_BUFFER_BIT);gl.disable(gl.SCISSOR_TEST);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,null,0);
  const output=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,8,8);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Color resource framebuffer is incomplete');
  return {assets,
    async frame(values) {
      for(const [name,value] of Object.entries(values)) {
        const {buffer,slot}=uniforms.get(name);
        gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferSubData(gl.UNIFORM_BUFFER,0,new Float32Array([...value,...new Array(4-value.length).fill(0)]));
        gl.bindBufferBase(gl.UNIFORM_BUFFER,slot,buffer);
      }
      gl.useProgram(program);gl.bindVertexArray(array);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      for(const [unit,mapping] of fixture.reflection.glslBindings.entries()) {
        const texture=fixture.reflection.resources.find(value=>value.group===mapping.texture.group&&value.binding===mapping.texture.binding);
        const sampler=fixture.reflection.resources.find(value=>value.group===mapping.sampler.group&&value.binding===mapping.sampler.binding);
        const storage=assets.image(texture.name).storage;
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(storage.target,storage.handle);gl.bindSampler(unit,assets.sampler(sampler.name).storage);
        gl.uniform1i(gl.getUniformLocation(program,mapping.name),unit);
      }
      gl.viewport(0,0,8,8);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLES,0,3);
      const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      if(gl.getError()!==gl.NO_ERROR) throw new Error('Shader resource pixels produced a WebGL API error');
      return [...pixel];
    },
    close() {for(const {buffer} of uniforms.values()) gl.deleteBuffer(buffer);gl.deleteTexture(output);gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(array);gl.deleteProgram(program);assets.close();gl.getExtension('WEBGL_lose_context').loseContext();}
  };
}

export async function verifyShaderResources() {
  const response=await fetch('/.cache/shader-resources-probe/resources.json');
  if(!response.ok) throw new Error('Shader resource fixture is missing');
  const fixture=await response.json(),backends=[];
  for(const [backend,create] of [['webgpu',webgpu],['webgl',webgl]]) {
    const runner=await create(fixture),assets=runner.assets;
    const values={uv:[0.5,0.5],direction:[1,0,0],level:[0],reference:[0.5],mode:[0]};
    const expect=async (updates,wanted,label)=>{
      Object.assign(values,updates);
      const actual=await runner.frame(values),expected=[...wanted.map(value=>Math.round(value*255)),255];
      if(actual.some((value,index)=>Math.abs(value-expected[index])>3)) throw new Error(`${backend} ${label}: ${actual}; expected ${expected}`);
    };
    try {
      assets.upload('paint',0,0,new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]));
      assets.upload('ink',0,0,new Uint8Array([128,128,128,255]));
      const half=(values)=>new Uint8Array(new Uint16Array(values).buffer);
      // Odd byte offsets still carry valid half-float data at the public byte boundary.
      const hdr=new Uint8Array(9).subarray(1);hdr.set(half([0x4000,0xb800,0x3800,0x3c00]));assets.upload('hdr',0,0,hdr);
      const faces=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1]];
      for(let face=0;face<6;face++) for(let level=0;level<2;level++) {
        const encoded=faces[face].map(value=>value?(level===0?0x3c00:0x3800):0);
        const pixels=new Uint16Array((level===0?4:1)*4);
        for(let index=0;index<pixels.length;index+=4) pixels.set([...encoded,0x3c00],index);
        assets.upload('sky',level,face,new Uint8Array(pixels.buffer));
      }
      await expect({},[1,0.5,0],'one image with independent nearest and linear samplers');
      for(const [uv,red] of [[[0.25,0.25],1],[[0.75,0.25],0],[[0.25,0.75],0],[[0.75,0.75],1]])
        await expect({uv},[red,red,0],'raw 2D upload row orientation');
      for(const [face,direction] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].entries())
        for(const level of [0,1]) await expect({mode:[1],direction,level:[level]},faces[face].map(value=>value/(level===0?1:2)),'cube face and mip level');
      await expect({mode:[2],uv:[0.125,0.5],level:[0]},[0,0,0],'shadow below reference');
      await expect({uv:[0.875,0.5]},[1,1,1],'shadow above reference');
      await expect({uv:[0.5,0.5]},[0.5,0.5,0.5],'linear depth comparison at boundary');
      const decoded=Math.pow((128/255+0.055)/1.055,2.4);
      await expect({mode:[3]},[decoded,decoded,decoded],'sRGB image decoded to linear values');
      await expect({mode:[4]},[0.5,0.375,0.125],'half-float image preserves HDR and negative values');
      const fixed=assets.image('paint').storage,generation=assets.generation;
      assets.resize(16,12);
      if(assets.image('paint').storage!==fixed||assets.generation===generation) throw new Error('Frame resize changed fixed image storage or retained its old target');
      await expect({},[0.5,0.375,0.125],'fixed resources survive target resize');
      backends.push(backend);
    } finally {runner.close();}
  }
  return backends;
}
