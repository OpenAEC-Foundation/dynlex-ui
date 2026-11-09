// Render compiled shader passes to a texture on the UI's selected device.
const fullscreen = `@vertex fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(points[index],0,1);
}`;

export async function createWebGpuShader(device, descriptor, target, retire) {
  const passes = [], depthEnabled = descriptor.passes.some(pass => pass.depth);
  let output = null, depth = null;
  const dispose = pass => {
    for (const binding of pass.bindings) binding.buffer.destroy();
    if (pass.vertices) retire(pass.vertices);
    if (pass.indices) retire(pass.indices);
  };
  async function module(code) {
    const result = device.createShaderModule({ code });
    const information = await result.getCompilationInfo();
    if (information.messages.some(message => message.type === 'error')) {
      console.error('DynLex shader compilation:', information.messages);
      throw new Error('Shader compilation failed');
    }
    return result;
  }
  try {
    for (const description of descriptor.passes) {
      const [vertex, fragment] = await Promise.all([
        module(description.vertex === null ? fullscreen : description.vertex), module(description.fragment)
      ]);
      const groups = [];
      for (const uniform of description.uniforms) {
        while (groups.length <= uniform.group) groups.push([]);
        groups[uniform.group].push({ binding: uniform.binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } });
      }
      const layouts = groups.map(entries => device.createBindGroupLayout({ entries }));
      const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module: vertex, entryPoint: 'main', buffers: description.vertex === null ? [] : [{
          arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }]
        }] },
        fragment: { module: fragment, entryPoint: 'main', targets: [{ format: 'rgba8unorm-srgb',
          ...(description.blend === 'additive' ? { blend: {
            color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' }
          } } : {}) }] },
        primitive: { topology: description.topology },
        ...(depthEnabled ? { depthStencil: { format: 'depth24plus', depthWriteEnabled: description.depth,
          depthCompare: description.depth ? 'less' : 'always' } } : {})
      });
      const pass = { pipeline, bindings: [], groups: [], vertices: null, indices: null,
        vertexCount: description.vertex === null ? 3 : 0, indexCount: 0 };
      passes.push(pass);
      for (const uniform of description.uniforms) {
        pass.bindings.push({ ...uniform, buffer: device.createBuffer({ size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) });
      }
      pass.groups = layouts.map((layout, index) => device.createBindGroup({ layout,
        entries: pass.bindings.filter(binding => binding.group === index).map(binding => ({
          binding: binding.binding, resource: { buffer: binding.buffer }
        })) }));
    }
  } catch (error) {
    for (const pass of passes) dispose(pass);
    throw error;
  }

  function buffer(data, usage) {
    const result = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    new Uint8Array(result.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    result.unmap();
    return result;
  }
  return {
    geometry(index, vertices, indices) {
      const pass = passes[index];
      const vertexBuffer = buffer(vertices, GPUBufferUsage.VERTEX);
      let indexBuffer = null;
      try { if (indices.length) indexBuffer = buffer(indices, GPUBufferUsage.INDEX); }
      catch (error) { vertexBuffer.destroy(); throw error; }
      if (pass.vertices) retire(pass.vertices);
      if (pass.indices) retire(pass.indices);
      Object.assign(pass, { vertices: vertexBuffer, indices: indexBuffer,
        vertexCount: vertices.length / 4, indexCount: indices.length });
    },
    render(width, height, values) {
      if (values.length !== passes.length) throw new Error('Shader values must describe every pass');
      if (output === null || output.width !== width || output.height !== height) {
        if (output) retire(output.texture);
        if (depth) retire(depth);
        output = target(width, height);
        if (depthEnabled) depth = device.createTexture({ size: [width, height], format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      for (const [index, pass] of passes.entries()) {
        for (const binding of pass.bindings) {
          const value = values[index][binding.name];
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing shader value: ${binding.name}`);
          device.queue.writeBuffer(binding.buffer, 0, new Float32Array([value, 0, 0, 0]));
        }
      }
      const encoder = device.createCommandEncoder();
      const render = encoder.beginRenderPass({ colorAttachments: [{ view: output.texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      ...(depthEnabled ? { depthStencilAttachment: { view: depth.createView(), depthClearValue: 1,
        depthLoadOp: 'clear', depthStoreOp: 'discard' } } : {}) });
      for (const pass of passes) {
        if (pass.vertexCount === 0) continue;
        render.setPipeline(pass.pipeline);
        for (const [index, group] of pass.groups.entries()) render.setBindGroup(index, group);
        if (pass.vertices) render.setVertexBuffer(0, pass.vertices);
        if (pass.indices) { render.setIndexBuffer(pass.indices, 'uint32'); render.drawIndexed(pass.indexCount); }
        else render.draw(pass.vertexCount);
      }
      render.end(); device.queue.submit([encoder.finish()]);
      return output;
    },
    close() {
      for (const pass of passes) dispose(pass);
      if (output) retire(output.texture);
      if (depth) retire(depth);
    }
  };
}
