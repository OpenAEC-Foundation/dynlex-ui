// Render compiled shader passes to a texture on the UI's selected device.
import { createShaderGeometry } from './shader-streams.js';
import { createShaderUniforms } from './shader-uniforms.js';
const fullscreen = `@vertex fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(points[index],0,1);
}`;

export async function createWebGpuShader(device, descriptor, target, retire) {
  const passes=[],depthEnabled=descriptor.passes.some(pass=>pass.depth);
  let output=null,depth=null,closed=false;
  const transfer={
    allocate(size,usage) {
      if(size>device.limits.maxBufferSize) throw new Error('Shader stream exceeds the device buffer limit');
      return device.createBuffer({size,usage:(usage==='vertex'?GPUBufferUsage.VERTEX:GPUBufferUsage.INDEX)|GPUBufferUsage.COPY_DST});
    },
    write(buffer,bytes) { device.queue.writeBuffer(buffer,0,bytes); },
    retire
  };
  const dispose=pass=>{
    if(pass.uniforms!==null) pass.uniforms.close();
    pass.geometry.close();
  };
  async function module(code) {
    const result=device.createShaderModule({code});
    const information=await result.getCompilationInfo();
    if(information.messages.some(message=>message.type==='error')) {
      console.error('DynLex shader compilation:',information.messages);
      throw new Error('Shader compilation failed');
    }
    return result;
  }
  try {
    for(const description of descriptor.passes) {
      const pass={geometry:createShaderGeometry(description,transfer),pipeline:null,uniforms:null,bindings:[],groups:[]};
      passes.push(pass);
      const [vertex,fragment]=await Promise.all([
        module(description.vertex===null?fullscreen:description.vertex),module(description.fragment)
      ]);
      const groups=[];
      for(const uniform of description.uniforms) {
        while(groups.length<=uniform.group) groups.push([]);
        groups[uniform.group].push({binding:uniform.binding,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}});
      }
      const layouts=groups.map(entries=>device.createBindGroupLayout({entries}));
      pass.pipeline=await device.createRenderPipelineAsync({
        layout:device.createPipelineLayout({bindGroupLayouts:layouts}),
        vertex:{module:vertex,entryPoint:'main',buffers:pass.geometry.layouts.map(layout=>({
          arrayStride:layout.arrayStride,stepMode:layout.stepMode,
          attributes:layout.attributes.map(({shaderLocation,offset,format})=>({shaderLocation,offset,format}))
        }))},
        fragment:{module:fragment,entryPoint:'main',targets:[{format:'rgba8unorm-srgb',
          ...(description.blend==='additive'?{blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}:{})}]},
        primitive:{topology:description.topology},
        ...(depthEnabled?{depthStencil:{format:'depth24plus',depthWriteEnabled:description.depth,depthCompare:description.depth?'less':'always'}}:{})
      });
      pass.uniforms=createShaderUniforms(description.uniforms,{
        allocate(description,size) {return device.createBuffer({size,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});},
        write(buffer,bytes) {device.queue.writeBuffer(buffer,0,bytes);}, retire
      });
      pass.bindings=pass.uniforms.bindings;
      pass.groups=layouts.map((layout,index)=>device.createBindGroup({layout,
        entries:pass.bindings.filter(binding=>binding.group===index).map(binding=>({binding:binding.binding,resource:{buffer:binding.buffer}}))}));
    }
  } catch(error) {
    for(const pass of passes) dispose(pass);
    throw error;
  }
  const active=()=>{if(closed) throw new Error('The shader program is closed');};
  const passAt=index=>{
    active();
    if(!Number.isInteger(index)||index<0||index>=passes.length) throw new Error('Unknown shader pass');
    return passes[index];
  };
  return {
    vertexBuffer(index,slot,data) { passAt(index).geometry.vertexBuffer(slot,data); },
    indexBuffer(index,data) { passAt(index).geometry.indexBuffer(data); },
    draws(index,data) { passAt(index).geometry.draws(data); },
    bufferBytes(index,slot) { return passAt(index).geometry.bufferBytes(slot); },
    bufferRecords(index,slot) { return passAt(index).geometry.bufferRecords(slot); },
    indexCount(index) { return passAt(index).geometry.indexCount; },
    uniformBuffer(index,group,binding,scalar,rows,columns,bytes) {
      passAt(index).uniforms.upload(group,binding,scalar,rows,columns,bytes);
    },
    render(width,height) {
      active();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||Math.max(width,height)>device.limits.maxTextureDimension2D)
        throw new Error('Shader target dimensions exceed device limits');
      for(const pass of passes) pass.uniforms.requireReady();
      const plans=passes.map(pass=>pass.geometry.commands);
      if(output===null||output.width!==width||output.height!==height) {
        if(output) retire(output.texture);
        if(depth) retire(depth);
        output=target(width,height);
        if(depthEnabled) depth=device.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
      }
      const encoder=device.createCommandEncoder();
      const render=encoder.beginRenderPass({colorAttachments:[{view:output.texture.createView(),
        clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}],
        ...(depthEnabled?{depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}}:{})});
      for(const [index,pass] of passes.entries()) {
        if(plans[index].length===0) continue;
        render.setPipeline(pass.pipeline);
        for(const [index,group] of pass.groups.entries()) render.setBindGroup(index,group);
        if(plans[index].some(command=>command.indexed)) render.setIndexBuffer(pass.geometry.indices.buffer,'uint32',0,pass.geometry.indices.byteLength);
        for(const command of plans[index]) {
          for(const [slot,stream] of pass.geometry.streams.entries())
            render.setVertexBuffer(slot,stream.buffer,command.offsets[slot],stream.byteLength-command.offsets[slot]);
          if(command.indexed) render.drawIndexed(command.count,command.instances,command.first,0,0);
          else render.draw(command.count,command.instances,command.first,0);
        }
      }
      render.end();device.queue.submit([encoder.finish()]);
      return output;
    },
    close() {
      active();closed=true;
      for(const pass of passes) dispose(pass);
      if(output) retire(output.texture);
      if(depth) retire(depth);
    }
  };
}
