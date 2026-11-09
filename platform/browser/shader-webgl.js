import { createWebGlProgram } from './graphics-backend.js';

const fullscreen = `#version 300 es
precision highp float;
const vec2 points[3] = vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
void main() { gl_Position=vec4(points[gl_VertexID],0,1); }`;

export function createWebGlShader(gl, descriptor, target) {
  const passes = [], framebuffer = gl.createFramebuffer(), depth = gl.createRenderbuffer();
  const depthEnabled = descriptor.passes.some(pass => pass.depth);
  let output = null;
  if (!framebuffer || !depth) {
    gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(depth);
    throw new Error('WebGL could not allocate shader attachments');
  }
  const dispose = pass => {
    for (const binding of pass.bindings) gl.deleteBuffer(binding.buffer);
    gl.deleteBuffer(pass.vertices); gl.deleteBuffer(pass.indices);
    gl.deleteVertexArray(pass.array); gl.deleteProgram(pass.program);
  };
  try {
    for (const description of descriptor.passes) {
      let nextBinding = 0;
      const program = createWebGlProgram(gl, description.vertex === null ? fullscreen : description.vertex, description.fragment);
      const pass = { program, bindings: [], vertices: null, indices: null, array: gl.createVertexArray(),
        vertexCount: description.vertex === null ? 3 : 0, indexCount: 0, depth: description.depth,
        blend: description.blend, topology: { 'triangle-list': gl.TRIANGLES, 'line-list': gl.LINES, 'point-list': gl.POINTS }[description.topology] };
      passes.push(pass);
      if (!pass.array) throw new Error('WebGL could not allocate shader geometry');
      const active = Array.from({ length: gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) }, (_, index) => ({
        index, name: gl.getActiveUniform(program, index).name
      }));
      for (const uniform of description.uniforms) {
        const matches = active.filter(item => item.name.includes(`_group_${uniform.group}_binding_${uniform.binding}_`));
        // The linker can eliminate a declared block whose value does not affect output.
        if (matches.length === 0) continue;
        const buffer = gl.createBuffer(), slot = nextBinding++;
        if (!buffer) throw new Error('WebGL could not allocate shader uniforms');
        pass.bindings.push({ ...uniform, buffer, slot });
        gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, 16, gl.DYNAMIC_DRAW);
        for (const match of matches) {
          const block = gl.getActiveUniforms(program, [match.index], gl.UNIFORM_BLOCK_INDEX)[0];
          gl.uniformBlockBinding(program, block, slot);
        }
      }
    }
  } catch (error) {
    for (const pass of passes) dispose(pass);
    gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(depth);
    throw error;
  }
  return {
    geometry(index, vertices, indices) {
      const pass = passes[index], vertexBuffer = gl.createBuffer();
      if (!vertexBuffer) throw new Error('WebGL could not allocate vertices');
      gl.bindVertexArray(pass.array); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      let indexBuffer = null;
      if (indices.length) {
        indexBuffer = gl.createBuffer();
        if (!indexBuffer) { gl.deleteBuffer(vertexBuffer); throw new Error('WebGL could not allocate indices'); }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      }
      gl.deleteBuffer(pass.vertices); gl.deleteBuffer(pass.indices);
      Object.assign(pass, { vertices: vertexBuffer, indices: indexBuffer,
        vertexCount: vertices.length / 4, indexCount: indices.length });
    },
    render(width, height, values) {
      if (values.length !== passes.length) throw new Error('Shader values must describe every pass');
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (output === null || output.width !== width || output.height !== height) {
        if (output) output.texture.destroy();
        output = target(width, height);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture.handle, 0);
        if (depthEnabled) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
        }
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('WebGL could not create the shader render target');
      }
      gl.viewport(0, 0, width, height); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
      gl.depthMask(true); gl.clearDepth(1); gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | (depthEnabled ? gl.DEPTH_BUFFER_BIT : 0));
      for (const [index, pass] of passes.entries()) {
        gl.useProgram(pass.program); gl.bindVertexArray(pass.array);
        for (const binding of pass.bindings) {
          const value = values[index][binding.name];
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing shader value: ${binding.name}`);
          gl.bindBuffer(gl.UNIFORM_BUFFER, binding.buffer);
          gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([value, 0, 0, 0]));
          gl.bindBufferBase(gl.UNIFORM_BUFFER, binding.slot, binding.buffer);
        }
        if (pass.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        gl.depthMask(pass.depth); gl.depthFunc(gl.LESS);
        if (pass.blend === 'additive') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
        else gl.disable(gl.BLEND);
        if (pass.indices) gl.drawElements(pass.topology, pass.indexCount, gl.UNSIGNED_INT, 0);
        else gl.drawArrays(pass.topology, 0, pass.vertexCount);
      }
      gl.disable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return output;
    },
    close() {
      for (const pass of passes) dispose(pass);
      if (output) output.texture.destroy();
      gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(depth);
    }
  };
}
