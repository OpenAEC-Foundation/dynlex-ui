// Asset decoding and GPU programs are platform services, not UI controllers.
export function createGraphicsServices({ gpu, surfaces, resources, id, memory, text, base }) {
  const programs = new Map(), assets = new Map();
  async function read(path, signal) {
    const response = await fetch(new URL(path, base), { signal });
    if (!response.ok) throw new Error(`Graphics asset: HTTP ${response.status}`);
    return response;
  }
  function own(surface, handle, close) { assets.set(handle, { surface, close }); }
  function release(handle) {
    const asset = assets.get(handle); assets.delete(handle); asset.close();
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
      const geometry = new Map();
      const passes = await Promise.all(payload.passes.map(async (pass, index) => {
        const vertex = pass.vertex === null ? null : stage(pass.vertex, signal);
        const fragment = stage(pass.fragment, signal);
        const data = pass.geometry === null ? null : Promise.all([
            read(pass.geometry.vertices, signal).then(response => response.arrayBuffer()),
            pass.geometry.indices === null ? Promise.resolve(new ArrayBuffer(0))
              : read(pass.geometry.indices, signal).then(response => response.arrayBuffer())
          ]);
        const [vertexCode, fragmentCode, buffers] = await Promise.all([vertex, fragment, data]);
        if (buffers !== null) geometry.set(index, {
          vertices: new Float32Array(buffers[0]), indices: new Uint32Array(buffers[1])
        });
        return { ...pass, vertex: vertexCode, fragment: fragmentCode };
      }));
      const renderer = await gpu.shader(surface, { passes });
      try {
        signal.throwIfAborted();
        for (const [index, data] of geometry) renderer.geometry(index, data.vertices, data.indices);
      } catch (error) { renderer.close(); throw error; }
      const handle = id(), output = id();
      programs.set(handle, { renderer, output });
      own(surface, handle, () => { programs.delete(handle); resources.delete(output); renderer.close(); });
      return { resource: handle, passes: passes.length };
    }
    if (payload.operation === 'release') { release(payload.resource); return null; }
    throw new Error(`Unknown graphics operation: ${payload.operation}`);
  }
  return { request, owns: handle => assets.has(handle), release,
    closeSurface(surface) {
      for (const [handle, asset] of [...assets]) if (asset.surface === surface) release(handle);
    },
    imports: {
      ui_image_upload(handle, pointer, width, height) {
        return upload(surfaces.get(handle), new Uint8Array(memory.buffer, pointer, width * height * 4), width, height).resource;
      },
      ui_shader_frame(handle, width, height, pointer, count) {
        const program = programs.get(handle);
        const texture = program.renderer.render(width, height, JSON.parse(text(pointer, count)));
        resources.set(program.output, texture);
        return program.output;
      },
      ui_shader_geometry(handle, pass, vertices, count, indices, indexCount) {
        programs.get(handle).renderer.geometry(pass, new Float32Array(memory.buffer, vertices, count * 4),
          new Uint32Array(memory.buffer, indices, indexCount));
      }
    }
  };
}
