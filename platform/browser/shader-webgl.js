import { createWebGlProgram } from './graphics-backend.js';
import { createShaderGeometry } from './shader-streams.js';

const fullscreen = `#version 300 es
precision highp float;
const vec2 points[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
void main(){gl_Position=vec4(points[gl_VertexID],0,1);}`;

function validateAttributes(gl,program,layouts) {
  const types=new Map();
  for(const [base,storage] of [['FLOAT','FLOAT'],['INT','INT'],['UNSIGNED_INT','UNSIGNED_INT']]) {
    types.set(gl[base],{components:1,storage});
    for(let size=2;size<=4;size++) types.set(gl[`${base}_VEC${size}`],{components:size,storage});
  }
  const attributes=layouts.flatMap(layout=>layout.attributes);
  for(let index=0;index<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);index++) {
    const active=gl.getActiveAttrib(program,index);
    // Builtin shader inputs are reflected too, but have no vertex-buffer location.
    if(active.name.startsWith('gl_')) continue;
    const type=types.get(active.type);
    const location=gl.getAttribLocation(program,active.name);
    const attribute=attributes.find(attribute=>attribute.shaderLocation===location);
    if(!type||active.size!==1||!attribute||type.components!==attribute.components||type.storage!==attribute.storage)
      throw new Error(`Shader attribute ${active.name} (type ${active.type}, size ${active.size}) has no matching typed layout at location ${location}`);
  }
}

export function createWebGlShader(gl,descriptor,target) {
  const passes=[],framebuffer=gl.createFramebuffer(),depthEnabled=descriptor.passes.some(pass=>pass.depth);
  const depth=depthEnabled?gl.createRenderbuffer():null;
  let output=null,closed=false;
  if(!framebuffer||(depthEnabled&&!depth)) {
    gl.deleteFramebuffer(framebuffer);gl.deleteRenderbuffer(depth);
    throw new Error('WebGL could not allocate shader attachments');
  }
  const targetFor=usage=>usage==='vertex'?gl.ARRAY_BUFFER:gl.ELEMENT_ARRAY_BUFFER;
  const transfer={
    allocate(size,usage) {
      const buffer=gl.createBuffer();
      if(!buffer) throw new Error('WebGL could not allocate a shader stream');
      gl.bindBuffer(targetFor(usage),buffer);gl.bufferData(targetFor(usage),size,gl.DYNAMIC_DRAW);
      if(gl.getError()!==gl.NO_ERROR) {gl.deleteBuffer(buffer);throw new Error('WebGL could not allocate shader stream storage');}
      return buffer;
    },
    write(buffer,bytes,usage) {gl.bindBuffer(targetFor(usage),buffer);gl.bufferSubData(targetFor(usage),0,bytes);},
    retire(buffer) {gl.deleteBuffer(buffer);}
  };
  const dispose=pass=>{
    for(const binding of pass.bindings) gl.deleteBuffer(binding.buffer);
    pass.geometry.close();gl.deleteVertexArray(pass.array);gl.deleteProgram(pass.program);
  };
  try {
    for(const description of descriptor.passes) {
      const pass={geometry:createShaderGeometry(description,transfer),program:null,array:null,bindings:[],
        depth:description.depth,blend:description.blend,
        topology:{'triangle-list':gl.TRIANGLES,'line-list':gl.LINES,'point-list':gl.POINTS}[description.topology]};
      passes.push(pass);
      if(pass.topology===undefined) throw new Error('Unsupported shader list topology');
      pass.program=createWebGlProgram(gl,description.vertex===null?fullscreen:description.vertex,description.fragment);
      pass.array=gl.createVertexArray();
      if(!pass.array) throw new Error('WebGL could not allocate a shader vertex array');
      validateAttributes(gl,pass.program,pass.geometry.layouts);
      const active=Array.from({length:gl.getProgramParameter(pass.program,gl.ACTIVE_UNIFORMS)},(_,index)=>({index,name:gl.getActiveUniform(pass.program,index).name}));
      let nextBinding=0;
      for(const uniform of description.uniforms) {
        const matches=active.filter(item=>item.name.includes(`_group_${uniform.group}_binding_${uniform.binding}_`));
        // A linker can eliminate a block that does not affect the output.
        if(matches.length===0) continue;
        const buffer=gl.createBuffer(),slot=nextBinding++;
        if(!buffer) throw new Error('WebGL could not allocate shader uniforms');
        pass.bindings.push({...uniform,buffer,slot});
        gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,16,gl.DYNAMIC_DRAW);
        for(const match of matches) {
          const block=gl.getActiveUniforms(pass.program,[match.index],gl.UNIFORM_BLOCK_INDEX)[0];
          gl.uniformBlockBinding(pass.program,block,slot);
        }
      }
    }
  } catch(error) {
    for(const pass of passes) dispose(pass);
    gl.deleteFramebuffer(framebuffer);gl.deleteRenderbuffer(depth);throw error;
  }
  const active=()=>{if(closed) throw new Error('The shader program is closed');};
  const passAt=index=>{
    active();
    if(!Number.isInteger(index)||index<0||index>=passes.length) throw new Error('Unknown shader pass');
    return passes[index];
  };
  return {
    vertexBuffer(index,slot,data) {const pass=passAt(index);gl.bindVertexArray(pass.array);pass.geometry.vertexBuffer(slot,data);},
    indexBuffer(index,data) {const pass=passAt(index);gl.bindVertexArray(pass.array);pass.geometry.indexBuffer(data);},
    draws(index,data) {passAt(index).geometry.draws(data);},
    bufferBytes(index,slot) {return passAt(index).geometry.bufferBytes(slot);},
    bufferRecords(index,slot) {return passAt(index).geometry.bufferRecords(slot);},
    indexCount(index) {return passAt(index).geometry.indexCount;},
    render(width,height,values) {
      active();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||Math.max(width,height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))
        throw new Error('Shader target dimensions exceed device limits');
      if(values.length!==passes.length) throw new Error('Shader values must describe every pass');
      const plans=passes.map(pass=>pass.geometry.commands);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      if(output===null||output.width!==width||output.height!==height) {
        if(output) output.texture.destroy();
        output=target(width,height);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output.texture.handle,0);
        if(depthEnabled) {
          gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
        }
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('WebGL could not create the shader render target');
      }
      gl.viewport(0,0,width,height);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);
      gl.depthMask(true);gl.clearDepth(1);gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT|(depthEnabled?gl.DEPTH_BUFFER_BIT:0));
      for(const [index,pass] of passes.entries()) {
        if(plans[index].length===0) continue;
        gl.useProgram(pass.program);gl.bindVertexArray(pass.array);
        for(const binding of pass.bindings) {
          const value=values[index][binding.name];
          if(typeof value!=='number'||!Number.isFinite(value)) throw new Error(`Missing shader value: ${binding.name}`);
          gl.bindBuffer(gl.UNIFORM_BUFFER,binding.buffer);gl.bufferSubData(gl.UNIFORM_BUFFER,0,new Float32Array([value,0,0,0]));
          gl.bindBufferBase(gl.UNIFORM_BUFFER,binding.slot,binding.buffer);
        }
        if(pass.depth) gl.enable(gl.DEPTH_TEST);else gl.disable(gl.DEPTH_TEST);
        gl.depthMask(pass.depth);gl.depthFunc(gl.LESS);
        if(pass.blend==='additive') {gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);}else gl.disable(gl.BLEND);
        for(const command of plans[index]) {
          for(const [slot,layout] of pass.geometry.layouts.entries()) {
            gl.bindBuffer(gl.ARRAY_BUFFER,pass.geometry.streams[slot].buffer);
            for(const attribute of layout.attributes) {
              gl.enableVertexAttribArray(attribute.shaderLocation);
              const offset=command.offsets[slot]+attribute.offset;
              if(attribute.integer) gl.vertexAttribIPointer(attribute.shaderLocation,attribute.components,gl[attribute.storage],layout.arrayStride,offset);
              else gl.vertexAttribPointer(attribute.shaderLocation,attribute.components,gl[attribute.storage],false,layout.arrayStride,offset);
              gl.vertexAttribDivisor(attribute.shaderLocation,layout.stepMode==='instance'?1:0);
            }
          }
          if(command.indexed) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,pass.geometry.indices.buffer);
            gl.drawElementsInstanced(pass.topology,command.count,gl.UNSIGNED_INT,command.first*4,command.instances);
          } else gl.drawArraysInstanced(pass.topology,command.first,command.count,command.instances);
        }
      }
      gl.disable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      return output;
    },
    close() {
      active();closed=true;
      for(const pass of passes) dispose(pass);
      if(output) output.texture.destroy();
      gl.deleteFramebuffer(framebuffer);gl.deleteRenderbuffer(depth);
    }
  };
}
