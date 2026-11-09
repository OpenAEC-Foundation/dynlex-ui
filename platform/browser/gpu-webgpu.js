// WebGPU submission for the shared 32-byte DynLex UI vertex format.
// https://www.w3.org/TR/webgpu/#canvas-configuration
import { clippedCommands } from "./draw-buffer.js";
const shader = `
struct Viewport { size: vec2f, padding: vec2f }
@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var filtering: sampler;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) ink: vec4f
}
@vertex fn vertex(@location(0) position: vec2f, @location(1) uv: vec2f,
                  @location(2) ink: vec4f) -> Vertex {
  var result: Vertex;
  result.position = vec4f(position.x / viewport.size.x * 2.0 - 1.0,
                         1.0 - position.y / viewport.size.y * 2.0, 0.0, 1.0);
  result.uv = uv;
  result.ink = ink;
  return result;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  return vec4f(input.ink.rgb, input.ink.a * textureSample(mask, filtering, input.uv).r);
}`;

export async function createWebGpu(device, reportError) {
  let closed = false;
  device.addEventListener("uncapturederror", event => reportError(event.error));
  device.lost.then(info => { if (!closed) reportError(new Error(info.message)); });
  const format = navigator.gpu.getPreferredCanvasFormat();
  const renderFormat = `${format}-srgb`;
  const module = device.createShaderModule({ code: shader });
  let pipeline;
  try {
    pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vertex", buffers: [{ arrayStride: 32, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x4" }
      ] }] },
      fragment: { module, entryPoint: "fragment", targets: [{ format: renderFormat, blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
      } }] },
      primitive: { topology: "triangle-list" }
    });
  } catch (error) {
    closed = true;
    device.destroy();
    throw error;
  }
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  function mask(surface, pixels, width, height) {
    const texture = device.createTexture({ size: [width, height], format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width }, [width, height]);
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: surface.uniform } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: sampler }
    ] });
    return { texture, group, width, height };
  }

  function surface(canvas) {
    const context = canvas.getContext("webgpu");
    context.configure({ device, format, viewFormats: [renderFormat], alphaMode: "opaque" });
    const result = { canvas, context,
      uniform: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), buffer: null };
    return result;
  }

  function retire(resource) {
    device.queue.onSubmittedWorkDone().then(() => resource.destroy());
  }

  function present(surface, width, height, scale) {
    const byteLength = surface.used * 4;
    if (byteLength > surface.capacity) {
      if (surface.buffer) retire(surface.buffer);
      surface.capacity = Math.max(16384, byteLength * 2);
      surface.buffer = device.createBuffer({ size: surface.capacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (byteLength) device.queue.writeBuffer(surface.buffer, 0, surface.vertices.buffer, 0, byteLength);
    device.queue.writeBuffer(surface.uniform, 0, new Float32Array([width, height, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: surface.context.getCurrentTexture().createView({ format: renderFormat }),
      clearValue: surface.clear, loadOp: "clear", storeOp: "store"
    }] });
    pass.setPipeline(pipeline);
    if (byteLength) pass.setVertexBuffer(0, surface.buffer);
    for (const { command, left, top, width, height } of clippedCommands(surface, scale)) {
      pass.setScissorRect(left, top, width, height);
      pass.setBindGroup(0, (command.texture === null ? surface.white : command.texture).group);
      pass.draw(command.count, 1, command.start);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function releaseSurface(surface) {
    surface.context.unconfigure();
    surface.uniform.destroy();
    if (surface.buffer) surface.buffer.destroy();
  }
  return { surface, present, mask, retire, releaseSurface,
    close() { closed = true; device.queue.onSubmittedWorkDone().then(() => device.destroy()); } };
}
