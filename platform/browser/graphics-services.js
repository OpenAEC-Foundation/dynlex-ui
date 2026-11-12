// Asset decoding and GPU programs are platform services, not UI controllers.
export function createGraphicsServices({ gpu, surfaces, resources, id, memory, base }) {
  const programs = new Map(), assets = new Map();
  async function read(path, signal) {
    const response = await fetch(new URL(path, base), { signal });
    if (!response.ok) throw new Error(`Graphics asset: HTTP ${response.status}`);
    return response;
  }
  function own(surface, handle, close) { assets.set(handle, { surface, close }); }
  function release(handle) {
    const asset = assets.get(handle);
    if (!asset) throw new Error('Unknown graphics resource');
    assets.delete(handle); asset.close();
  }
  function upload(surface, pixels, width, height) {
    const handle = id(), resource = gpu.image(surface, pixels, width, height);
    resources.set(handle, resource);
    own(surface, handle, () => { resources.delete(handle); gpu.retire(resource.texture); });
    return { resource: handle, width, height };
  }
  async function stage(description, signal) {
    const source = description[gpu.backend];
    if (source.kind === 'source') return source.value;
    if (source.kind === 'url') return (await read(source.value, signal)).text();
    throw new Error(`Unknown shader source kind: ${source.kind}`);
  }
  async function request(payload, { signal }, surface) {
    if (payload.operation === 'image') {
      const blob = await (await read(payload.path, signal)).blob();
      const url = URL.createObjectURL(blob), image = new Image();
      try {
        image.src = url; await image.decode(); signal.throwIfAborted();
        let width = payload.width, height = payload.height;
        if (width === 0 && height === 0) { width = image.naturalWidth; height = image.naturalHeight; }
        else if (width === 0) width = height * image.naturalWidth / image.naturalHeight;
        else if (height === 0) height = width * image.naturalHeight / image.naturalWidth;
        width = Math.ceil(width); height = Math.ceil(height);
        if (!(width > 0 && height > 0)) throw new Error('Image dimensions must be positive');
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        return upload(surface, context.getImageData(0, 0, width, height).data, width, height);
      } finally { URL.revokeObjectURL(url); }
    }
    if (payload.operation === 'shader') {
      const prepared = await Promise.all(payload.passes.map(async pass => {
        const [vertex,fragment,vertices,indices] = await Promise.all([
          pass.vertex === null ? null : stage(pass.vertex,signal), stage(pass.fragment,signal),
          Promise.all(pass.vertexBuffers.map(buffer => buffer.source === null ? null
            : read(buffer.source,signal).then(response => response.arrayBuffer()))),
          pass.indices === null ? null : read(pass.indices,signal).then(response => response.arrayBuffer())
        ]);
        return { description:{...pass,vertex,fragment},vertices,indices };
      }));
      const renderer = await gpu.shader(surface,{passes:prepared.map(pass => pass.description)});
      try {
        signal.throwIfAborted();
        for (const [index,pass] of prepared.entries()) {
          for (const [slot,data] of pass.vertices.entries()) if (data !== null)
            renderer.vertexBuffer(index,slot,new Uint8Array(data));
          if (pass.indices !== null) renderer.indexBuffer(index,new Uint32Array(pass.indices));
        }
      } catch (error) { renderer.close(); throw error; }
      const handle = id(), output = id();
      programs.set(handle, { renderer, output, surface });
      own(surface, handle, () => { programs.delete(handle); resources.delete(output); renderer.close(); });
      return { resource: handle, passes: prepared.length };
    }
    if (payload.operation === 'release') {
      const asset=assets.get(payload.resource);
      if (!asset) throw new Error('Unknown graphics resource');
      if (asset.surface !== surface) throw new Error('The graphics resource belongs to a different surface');
      release(payload.resource); return null;
    }
    throw new Error(`Unknown graphics operation: ${payload.operation}`);
  }
  function programFor(surface,handle) {
    const program=programs.get(handle);
    if (!program) throw new Error('Unknown shader resource');
    if (program.surface !== surfaces.get(surface)) throw new Error('The shader belongs to a different surface');
    return program;
  }
  return { request, owns: handle => assets.has(handle), release,
    closeSurface(surface) {
      for (const [handle, asset] of [...assets]) if (asset.surface === surface) release(handle);
    },
    imports: {
      ui_image_upload(handle, pointer, width, height) {
        return upload(surfaces.get(handle), new Uint8Array(memory.buffer, pointer, width * height * 4), width, height).resource;
      },
      ui_shader_frame(surface,handle,width,height) {
        const program=programFor(surface,handle);
        const texture=program.renderer.render(width,height);
        resources.set(program.output,texture);
        return program.output;
      },
      ui_shader_uniform(surface,handle,pass,group,binding,scalar,rows,columns,pointer,bytes) {
        programFor(surface,handle).renderer.uniformBuffer(pass,group,binding,scalar,rows,columns,new Uint8Array(memory.buffer,pointer,bytes));
      },
      ui_shader_vertex_buffer(surface,handle,pass,slot,pointer,bytes) {
        programFor(surface,handle).renderer.vertexBuffer(pass,slot,new Uint8Array(memory.buffer,pointer,bytes));
      },
      ui_shader_index_buffer(surface,handle,pass,pointer,count) {
        programFor(surface,handle).renderer.indexBuffer(pass,new Uint32Array(memory.buffer,pointer,count));
      },
      ui_shader_draws(surface,handle,pass,pointer,count) {
        programFor(surface,handle).renderer.draws(pass,new Uint32Array(memory.buffer,pointer,count*6));
      },
      ui_shader_buffer_bytes(surface,handle,pass,slot) { return programFor(surface,handle).renderer.bufferBytes(pass,slot); },
      ui_shader_buffer_records(surface,handle,pass,slot) { return programFor(surface,handle).renderer.bufferRecords(pass,slot); },
      ui_shader_index_count(surface,handle,pass) { return programFor(surface,handle).renderer.indexCount(pass); },
      ui_shader_close(surface,handle) { programFor(surface,handle); release(handle); }
    }
  };
}
