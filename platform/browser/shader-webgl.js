import { createWebGlProgram } from './graphics-backend.js';
import { createShaderGeometry } from './shader-streams.js';
import { createShaderUniforms } from './shader-uniforms.js';
import {createShaderAssets} from './shader-assets.js';
import {webGlShaderAssetDriver} from './shader-assets-webgl.js';
import {createWebGlShaderTargets} from './shader-targets-webgl.js';
import {createWebGlPrimitiveDraws} from './shader-provoking-webgl.js';

const fullscreen = `#version 300 es
precision highp float;
const vec2 points[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
void main(){vec2 point=points[gl_VertexID];gl_Position=vec4(point.x,-point.y,-1,1);}`;

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

const emptyFragment='#version 300 es\nprecision highp float;void main(){}';

export function createWebGlShader(gl,descriptor,target) {
  const assets=createShaderAssets(descriptor.assets,webGlShaderAssetDriver(gl)),passes=[];
  const provoking=gl.getExtension('WEBGL_provoking_vertex');
  let output=null,closed=false;
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
    if(pass.uniforms!==null) pass.uniforms.close();
    if(pass.primitives!==null) pass.primitives.close();
    pass.geometry.close();pass.targets.close();gl.deleteVertexArray(pass.array);gl.deleteProgram(pass.program);
  };
  const comparison={never:gl.NEVER,less:gl.LESS,'less-equal':gl.LEQUAL,equal:gl.EQUAL,'not-equal':gl.NOTEQUAL,
    greater:gl.GREATER,'greater-equal':gl.GEQUAL,always:gl.ALWAYS};
  const factors={zero:gl.ZERO,one:gl.ONE,src:gl.SRC_COLOR,'one-minus-src':gl.ONE_MINUS_SRC_COLOR,
    'src-alpha':gl.SRC_ALPHA,'one-minus-src-alpha':gl.ONE_MINUS_SRC_ALPHA,dst:gl.DST_COLOR,'one-minus-dst':gl.ONE_MINUS_DST_COLOR,
    'dst-alpha':gl.DST_ALPHA,'one-minus-dst-alpha':gl.ONE_MINUS_DST_ALPHA,constant:gl.CONSTANT_COLOR,
    'one-minus-constant':gl.ONE_MINUS_CONSTANT_COLOR,'src-alpha-saturated':gl.SRC_ALPHA_SATURATE};
  const equations={add:gl.FUNC_ADD,subtract:gl.FUNC_SUBTRACT,'reverse-subtract':gl.FUNC_REVERSE_SUBTRACT,min:gl.MIN,max:gl.MAX};
  try {
    for(const description of descriptor.passes) {
      const pass={description,geometry:createShaderGeometry(description,transfer),program:null,array:null,uniforms:null,slots:new Map(),textures:[],
        primitives:provoking===null?createWebGlPrimitiveDraws(description.topology,transfer):null,
        targets:createWebGlShaderTargets(gl,assets,description.color,description.depth),
        topology:{'triangle-list':gl.TRIANGLES,'line-list':gl.LINES,'point-list':gl.POINTS}[description.topology]};
      passes.push(pass);
      if(pass.topology===undefined) throw new Error('Unsupported shader list topology');
      pass.program=createWebGlProgram(gl,description.vertex===null?fullscreen:description.vertex,
        description.fragment===null?emptyFragment:description.fragment);
      pass.array=gl.createVertexArray();
      if(!pass.array) throw new Error('WebGL could not allocate a shader vertex array');
      validateAttributes(gl,pass.program,pass.geometry.layouts);
      let nextBinding=0;
      pass.uniforms=createShaderUniforms(description.uniforms,{
        allocate(uniform,bytes) {
          const blocks=[...new Set(description.glslUniforms.filter(item=>item.group===uniform.group&&item.binding===uniform.binding)
            .map(item=>gl.getUniformBlockIndex(pass.program,item.name)).filter(index=>index!==gl.INVALID_INDEX))];
          // Linking may eliminate uniform blocks which do not affect the output.
          if(blocks.length===0) return null;
          for(const block of blocks) if(gl.getActiveUniformBlockParameter(pass.program,block,gl.UNIFORM_BLOCK_DATA_SIZE)>bytes)
            throw new Error('Shader uniform block exceeds its reflected storage layout');
          const buffer=gl.createBuffer(),slot=nextBinding++;
          if(!buffer) throw new Error('WebGL could not allocate shader uniforms');
          pass.slots.set(buffer,slot);gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,bytes,gl.DYNAMIC_DRAW);
          for(const block of blocks) gl.uniformBlockBinding(pass.program,block,slot);
          return buffer;
        },
        write(buffer,bytes) {gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferSubData(gl.UNIFORM_BUFFER,0,bytes);},
        retire(buffer) {gl.deleteBuffer(buffer);}
      });
      const units=new Map();
      const resourceAt=slot=>description.resources.find(resource=>resource.group===slot.group&&resource.binding===slot.binding);
      for(const mapping of description.glslBindings) {
        const location=gl.getUniformLocation(pass.program,mapping.name);
        if(location===null) continue;
        const key=JSON.stringify([mapping.texture,mapping.sampler]);
        let entry=units.get(key);
        if(entry===undefined) {
          entry={image:resourceAt(mapping.texture).name,sampler:mapping.sampler===null?null:resourceAt(mapping.sampler).name,locations:[]};
          units.set(key,entry);pass.textures.push(entry);
        }
        entry.locations.push(location);
      }
      if(pass.textures.length>gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)) throw new Error('Shader sampled resources exceed device limits');
    }
  } catch(error) {for(const pass of passes) dispose(pass);assets.close();throw error;}
  const active=()=>{if(closed) throw new Error('The shader program is closed');};
  const passAt=index=>{
    active();if(!Number.isInteger(index)||index<0||index>=passes.length) throw new Error('Unknown shader pass');
    return passes[index];
  };
  return {
    vertexBuffer(index,slot,data) {const pass=passAt(index);gl.bindVertexArray(pass.array);pass.geometry.vertexBuffer(slot,data);},
    indexBuffer(index,data) {const pass=passAt(index);gl.bindVertexArray(pass.array);pass.geometry.indexBuffer(data);},
    draws(index,data) {passAt(index).geometry.draws(data);},
    bufferBytes(index,slot) {return passAt(index).geometry.bufferBytes(slot);},
    bufferRecords(index,slot) {return passAt(index).geometry.bufferRecords(slot);},
    indexCount(index) {return passAt(index).geometry.indexCount;},
    imageBytes(name,level,layer,bytes) {active();assets.upload(name,level,layer,bytes);},
    uniformBuffer(index,group,binding,scalar,rows,columns,bytes) {passAt(index).uniforms.upload(group,binding,scalar,rows,columns,bytes);},
    render(width,height) {
      active();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||Math.max(width,height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))
        throw new Error('Shader target dimensions exceed device limits');
      for(const pass of passes) pass.uniforms.requireReady();
      const plans=passes.map(pass=>pass.primitives===null?pass.geometry.commands:pass.primitives.prepare(pass.geometry));
      if(provoking!==null) provoking.provokingVertexWEBGL(provoking.FIRST_VERTEX_CONVENTION_WEBGL);
      assets.resize(width,height);
      const record=assets.image(descriptor.output);
      if(output===null||output.texture!==record.storage) output=target(record);
      for(const [index,pass] of passes.entries()) {
        pass.targets.begin();gl.useProgram(pass.program);gl.bindVertexArray(pass.array);
        for(const binding of pass.uniforms.bindings) gl.bindBufferBase(gl.UNIFORM_BUFFER,pass.slots.get(binding.buffer),binding.buffer);
        for(const [unit,binding] of pass.textures.entries()) {
          const image=assets.image(binding.image).storage;
          gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(image.target,image.handle);
          gl.bindSampler(unit,binding.sampler===null?null:assets.sampler(binding.sampler).storage);
          for(const location of binding.locations) gl.uniform1i(location,unit);
        }
        const state=pass.description.state;
        if(pass.description.depth!==null) gl.enable(gl.DEPTH_TEST);else gl.disable(gl.DEPTH_TEST);
        gl.depthMask(state.depthWrite);gl.depthFunc(comparison[state.depthCompare]);
        if(state.cullMode==='none') gl.disable(gl.CULL_FACE);
        else {gl.enable(gl.CULL_FACE);gl.cullFace(state.cullMode==='front'?gl.FRONT:gl.BACK);}
        // Naga's GLSL output adjusts clip-space Y relative to WebGPU.
        gl.frontFace(state.frontFace==='ccw'?gl.CW:gl.CCW);
        if(state.blend===null) gl.disable(gl.BLEND);
        else {
          const {color,alpha}=state.blend;gl.enable(gl.BLEND);
          gl.blendFuncSeparate(factors[color.srcFactor],factors[color.dstFactor],factors[alpha.srcFactor],factors[alpha.dstFactor]);
          gl.blendEquationSeparate(equations[color.operation],equations[alpha.operation]);
        }
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
          if(command.indexed) {gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,pass.primitives===null?pass.geometry.indices.buffer:pass.primitives.buffer);gl.drawElementsInstanced(pass.topology,command.count,gl.UNSIGNED_INT,command.first*4,command.instances);}
          else gl.drawArraysInstanced(pass.topology,command.first,command.count,command.instances);
        }
        pass.targets.end();
        for(let unit=0;unit<pass.textures.length;unit++) gl.bindSampler(unit,null);
      }
      gl.activeTexture(gl.TEXTURE0);gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);return output;
    },
    close() {active();closed=true;for(const pass of passes) dispose(pass);assets.close();}
  };
}
