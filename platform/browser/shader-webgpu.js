// Submit the DynLex pass graph on the UI's selected WebGPU device.
import {createShaderGeometry} from './shader-streams.js';
import {createShaderUniforms} from './shader-uniforms.js';
import {createShaderAssets} from './shader-assets.js';
import {webGpuShaderAssetDriver} from './shader-assets-webgpu.js';
import {createWebGpuShaderTargets} from './shader-targets-webgpu.js';
const fullscreen=`@vertex fn main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let points=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(points[index],0,1);
}`;

export async function createWebGpuShader(device,descriptor,target,retire) {
  const assets=createShaderAssets(descriptor.assets,webGpuShaderAssetDriver(device,retire)),passes=[];
  let output=null,closed=false;
  const transfer={
    allocate(size,usage) {
      if(size>device.limits.maxBufferSize) throw new Error('Shader stream exceeds the device buffer limit');
      return device.createBuffer({size,usage:(usage==='vertex'?GPUBufferUsage.VERTEX:GPUBufferUsage.INDEX)|GPUBufferUsage.COPY_DST});
    },
    write(buffer,bytes) {device.queue.writeBuffer(buffer,0,bytes);},retire
  };
  const dispose=pass=>{if(pass.uniforms!==null) pass.uniforms.close();pass.geometry.close();};
  const modules=new Map();
  async function compileModule(code) {
    const result=device.createShaderModule({code}),information=await result.getCompilationInfo();
    if(information.messages.some(message=>message.type==='error')) {
      console.error('DynLex shader compilation:',information.messages);throw new Error('Shader compilation failed');
    }
    return result;
  }
  const module=code=>{
    if(!modules.has(code)) modules.set(code,compileModule(code));
    return modules.get(code);
  };
  try {
    for(const description of descriptor.passes) {
      const pass={description,geometry:createShaderGeometry(description,transfer),pipelines:[],uniforms:null,
        layouts:[],groups:[],generation:-1,targets:createWebGpuShaderTargets(assets,description.color,description.depth)};
      passes.push(pass);
      const [vertex,fragment]=await Promise.all([module(description.vertex===null?fullscreen:description.vertex),
        description.fragment===null?null:module(description.fragment)]);
      const groups=[];
      const bind=(group,entry)=>{
        if(group>=device.limits.maxBindGroups) throw new Error('Shader bind groups exceed device limits');
        while(groups.length<=group) groups.push([]);
        groups[group].push({visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,...entry});
      };
      for(const uniform of description.uniforms) bind(uniform.group,{binding:uniform.binding,buffer:{type:'uniform'}});
      for(const resource of description.resources) bind(resource.group,{binding:resource.binding,
        ...(resource.kind==='texture'?{texture:{sampleType:resource.sampleType,viewDimension:resource.dimension}}
          :{sampler:{type:resource.comparison?'comparison':'filtering'}})});
      pass.layouts=groups.map(entries=>device.createBindGroupLayout({entries}));
      const color=description.color===null?null:assets.definition(description.color.view.image);
      const depth=description.depth===null?null:assets.definition(description.depth.view.image);
      if(color===null&&depth===null) throw new Error('A shader pass requires an attachment');
      const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:pass.layouts});
      for(const state of description.pipelines) pass.pipelines.push(await device.createRenderPipelineAsync({
        layout:pipelineLayout,
        vertex:{module:vertex,entryPoint:'main',buffers:pass.geometry.layouts.map(layout=>({
          arrayStride:layout.arrayStride,stepMode:layout.stepMode,
          attributes:layout.attributes.map(({shaderLocation,offset,format})=>({shaderLocation,offset,format}))}))},
        ...(fragment===null?{}:{fragment:{module:fragment,entryPoint:'main',targets:color===null?[]:[{format:color.format,
          ...(state.blend===null?{}:{blend:state.blend})}]}}),
        primitive:{topology:description.topology,cullMode:state.cullMode,frontFace:state.frontFace},
        multisample:{count:(color===null?depth:color).samples},
        ...(depth===null?{}:{depthStencil:{format:depth.format,depthWriteEnabled:state.depthWrite,depthCompare:state.depthCompare}})
      }));
      pass.uniforms=createShaderUniforms(description.uniforms,{
        allocate(description,size) {return device.createBuffer({size,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});},
        write(buffer,bytes) {device.queue.writeBuffer(buffer,0,bytes);},retire
      });
    }
  } catch(error) {for(const pass of passes) dispose(pass);assets.close();throw error;}
  const active=()=>{if(closed) throw new Error('The shader program is closed');};
  const passAt=index=>{
    active();if(!Number.isInteger(index)||index<0||index>=passes.length) throw new Error('Unknown shader pass');
    return passes[index];
  };
  const bindGroups=pass=>{
    if(pass.generation===assets.generation) return;
    const entries=pass.uniforms.bindings.map(binding=>({group:binding.group,binding:binding.binding,resource:{buffer:binding.buffer}}));
    for(const resource of pass.description.resources) entries.push({group:resource.group,binding:resource.binding,
      resource:resource.kind==='texture'?assets.image(resource.name).storage.createView({dimension:resource.dimension}):assets.sampler(resource.name).storage});
    pass.groups=pass.layouts.map((layout,index)=>device.createBindGroup({layout,
      entries:entries.filter(entry=>entry.group===index).map(({binding,resource})=>({binding,resource}))}));
    pass.generation=assets.generation;
  };
  return {
    vertexBuffer(index,slot,data) {passAt(index).geometry.vertexBuffer(slot,data);},
    indexBuffer(index,data) {passAt(index).geometry.indexBuffer(data);},
    draws(index,data) {passAt(index).geometry.draws(data);},
    bufferBytes(index,slot) {return passAt(index).geometry.bufferBytes(slot);},
    bufferRecords(index,slot) {return passAt(index).geometry.bufferRecords(slot);},
    indexCount(index) {return passAt(index).geometry.indexCount;},
    imageBytes(name,level,layer,bytes) {active();assets.upload(name,level,layer,bytes);},
    uniformBuffer(index,group,binding,scalar,rows,columns,bytes) {passAt(index).uniforms.upload(group,binding,scalar,rows,columns,bytes);},
    render(width,height) {
      active();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||Math.max(width,height)>device.limits.maxTextureDimension2D)
        throw new Error('Shader target dimensions exceed device limits');
      for(const pass of passes) pass.uniforms.requireReady();
      const plans=passes.map(pass=>pass.geometry.commands);
      assets.resize(width,height);
      const record=assets.image(descriptor.output);
      if(output===null||output.texture!==record.storage) output=target(record);
      const encoder=device.createCommandEncoder();
      for(const [index,pass] of passes.entries()) {
        bindGroups(pass);
        const render=encoder.beginRenderPass(pass.targets.description());
        for(const [index,group] of pass.groups.entries()) render.setBindGroup(index,group);
        if(plans[index].some(command=>command.indexed)) render.setIndexBuffer(pass.geometry.indices.buffer,'uint32',0,pass.geometry.indices.byteLength);
        let pipeline=-1;
        for(const command of plans[index]) {
          if(command.pipeline!==pipeline) {render.setPipeline(pass.pipelines[command.pipeline]);pipeline=command.pipeline;}
          for(const [slot,stream] of pass.geometry.streams.entries()) render.setVertexBuffer(slot,stream.buffer,command.offsets[slot],stream.byteLength-command.offsets[slot]);
          if(command.indexed) render.drawIndexed(command.count,command.instances,command.first,0,0);
          else render.draw(command.count,command.instances,command.first,0);
        }
        render.end();
      }
      device.queue.submit([encoder.finish()]);return output;
    },
    close() {active();closed=true;for(const pass of passes) dispose(pass);assets.close();}
  };
}
