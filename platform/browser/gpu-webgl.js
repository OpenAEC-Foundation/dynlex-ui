import { createWebGlProgram } from "./graphics-backend.js";
import { clippedCommands } from "./draw-buffer.js";

const vertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec2 position;
layout(location = 1) in vec2 uv;
layout(location = 2) in vec4 ink;
uniform vec2 viewport;
out vec2 maskPoint;
out vec4 paint;
void main() {
  gl_Position = vec4(position.x / viewport.x * 2.0 - 1.0,
                     1.0 - position.y / viewport.y * 2.0, 0.0, 1.0);
  maskPoint = uv;
  paint = ink;
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D mask;
in vec2 maskPoint;
in vec4 paint;
out vec4 color;
void main() {
  color = vec4(paint.rgb, paint.a * texture(mask, maskPoint).r);
}`;

const copyVertexShader = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const copyFragmentShader = `#version 300 es
precision highp float;
uniform sampler2D image;
in vec2 uv;
out vec4 color;
void main() {
  vec3 linear = max(texture(image, uv).rgb, vec3(0.0));
  vec3 srgb = mix(1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055,
                  linear * 12.92, lessThanEqual(linear, vec3(0.0031308)));
  color = vec4(srgb, 1.0);
}`;

export function createWebGl(reportError) {
  function surface(canvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error("Neither a WebGPU device nor a WebGL2 context is available");
    let program = null, copy = null, buffer = null, array = null, empty = null, framebuffer = null;
    const destroy = () => {
      gl.deleteFramebuffer(framebuffer); gl.deleteBuffer(buffer);
      gl.deleteVertexArray(array); gl.deleteVertexArray(empty);
      gl.deleteProgram(program); gl.deleteProgram(copy);
    };
    try {
      program = createWebGlProgram(gl, vertexShader, fragmentShader);
      copy = createWebGlProgram(gl, copyVertexShader, copyFragmentShader);
      buffer = gl.createBuffer(); array = gl.createVertexArray(); empty = gl.createVertexArray();
      framebuffer = gl.createFramebuffer();
      if (!buffer || !array || !empty || !framebuffer) throw new Error("WebGL could not allocate UI resources");
      gl.bindVertexArray(array);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [location, count, offset] of [[0, 2, 0], [1, 2, 8], [2, 4, 16]]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, count, gl.FLOAT, false, 32, offset);
      }
      const lost = () => reportError(new Error("The WebGL rendering context was lost"));
      canvas.addEventListener("webglcontextlost", lost);
      return { gl, program, copy, buffer, array, empty, framebuffer, lost, destroy,
        viewport: gl.getUniformLocation(program, "viewport"), target: null, targetWidth: 0, targetHeight: 0 };
    } catch (error) {
      destroy();
      throw error;
    }
  }

  function texture(gl, width, height, format, pixels) {
    const handle = gl.createTexture();
    if (!handle) throw new Error("WebGL could not allocate a UI texture");
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    if (pixels !== null) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, pixels);
    }
    return { handle, destroy() { gl.deleteTexture(handle); } };
  }

  function mask(surface, pixels, width, height) {
    return { texture: texture(surface.gl, width, height, surface.gl.R8, pixels), width, height };
  }

  function present(surface, width, height, scale) {
    const { gl, canvas } = surface;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer);
    if (surface.targetWidth !== canvas.width || surface.targetHeight !== canvas.height) {
      if (surface.target) surface.target.destroy();
      // Match Vulkan/WebGPU: blend in linear light, store in an sRGB attachment.
      surface.target = texture(gl, canvas.width, canvas.height, gl.SRGB8_ALPHA8, null);
      surface.targetWidth = canvas.width; surface.targetHeight = canvas.height;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface.target.handle, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("WebGL could not create the UI render target");
      }
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    const { r, g, b, a } = surface.clear;
    gl.clearColor(r, g, b, a); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(surface.program);
    gl.uniform2f(surface.viewport, width, height);
    gl.bindVertexArray(surface.array);
    gl.bindBuffer(gl.ARRAY_BUFFER, surface.buffer);
    const byteLength = surface.used * 4;
    if (byteLength > surface.capacity) {
      surface.capacity = Math.max(16384, byteLength * 2);
      gl.bufferData(gl.ARRAY_BUFFER, surface.capacity, gl.DYNAMIC_DRAW);
    }
    if (byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, surface.vertices.subarray(0, surface.used));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    for (const { command, left, top, width, height } of clippedCommands(surface, scale)) {
      gl.scissor(left, canvas.height - top - height, width, height);
      const resource = command.texture === null ? surface.white : command.texture;
      gl.bindTexture(gl.TEXTURE_2D, resource.texture.handle);
      gl.drawArrays(gl.TRIANGLES, command.start, command.count);
    }
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(surface.copy); gl.bindVertexArray(surface.empty);
    gl.bindTexture(gl.TEXTURE_2D, surface.target.handle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function releaseSurface(surface) {
    surface.canvas.removeEventListener("webglcontextlost", surface.lost);
    if (surface.target) surface.target.destroy();
    surface.destroy();
  }

  return { surface, mask, present, releaseSurface, retire(resource) { resource.destroy(); }, close() {} };
}
