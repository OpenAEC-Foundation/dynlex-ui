import { createGpu } from '/platform/gpu.js';

// Pixel checks use the public submission ABI, independent of application layout.
export async function verifyRendering() {
  const errors = [];
  const gpu = await createGpu(error => errors.push(error));
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 72;
  const surface = gpu.surface(canvas);
  const mask = gpu.mask(surface, new Uint8Array(6).fill(128), 3, 2);
  const clip = { x: -3, y: 4, width: 43, height: 24 };
  const box = (left, top, width, height, value, alpha, texture, bounds) => {
    const vertices = [];
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      vertices.push(left + x * width, top + y * height, x, y, value, value, value, alpha);
    }
    gpu.triangles(surface, new Float32Array(vertices), texture, bounds);
  };
  try {
    gpu.begin(surface, [0, 0, 0]);
    box(0, 0, 64, 48, 0.25, 1, null, clip);
    box(8, 8, 16, 16, 1, 0.5, null, clip);
    box(28, 8, 8, 16, 1, 1, mask, clip);
    gpu.present(surface, 64, 48, 1.5);
    const context = new OffscreenCanvas(96, 72).getContext('2d');
    context.drawImage(canvas, 0, 0);
    const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    const expected = (x, y, value) => {
      const actual = pixel(x, y);
      if (actual.slice(0, 3).some(channel => Math.abs(channel - value) > 3) || actual[3] !== 255) {
        throw new Error(`Pixel ${x},${y}: ${actual}; expected ${value},${value},${value},255`);
      }
    };
    expected(3, 3, 0);       // Top scissor edge.
    expected(3, 9, 137);     // Linear 0.25 encoded to sRGB.
    expected(18, 18, 207);   // 50% white blended over linear 0.25.
    expected(48, 18, 207);   // Odd-width R8 texture, first row.
    expected(48, 30, 207);   // Odd-width R8 texture, second row.
    expected(65, 18, 0);     // Right scissor edge.
    expected(18, 45, 0);     // Bottom scissor edge.
    if (surface.gl && surface.gl.getError() !== surface.gl.NO_ERROR) throw new Error('WebGL rendering produced an API error');
    if (errors.length) throw errors[0];
  } finally {
    gpu.retire(mask.texture);
    gpu.releaseSurface(surface);
    gpu.close();
  }
}

export async function verifyFailureBoundaries() {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'gpu');
  const getContext = HTMLCanvasElement.prototype.getContext;
  let webGlRequests = 0, destroyed = false;
  const failure = new Error('A rendering pipeline failed after device selection');
  const device = { addEventListener() {}, lost: new Promise(() => {}),
    createShaderModule() { return {}; },
    async createRenderPipelineAsync() { throw failure; },
    destroy() { destroyed = true; } };
  const use = gpu => Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => gpu });
  try {
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === 'webgl2') { webGlRequests++; return null; }
      return getContext.call(this, kind, ...args);
    };
    use(undefined);
    const gpu = await createGpu(error => { throw error; });
    let unavailable = false;
    try { gpu.surface(document.createElement('canvas')); }
    catch (error) { unavailable = error.message.includes('Neither a WebGPU device nor a WebGL2 context'); }
    finally { gpu.close(); }
    if (!unavailable) throw new Error('A browser with neither graphics API must fail explicitly');
    const before = webGlRequests;
    use({ async requestAdapter() { return { async requestDevice() { return device; } }; },
      getPreferredCanvasFormat() { return 'bgra8unorm'; } });
    let rejected = false;
    try { await createGpu(error => { throw error; }); }
    catch (error) { rejected = error === failure; }
    if (!rejected || !destroyed || webGlRequests !== before) {
      throw new Error('A pipeline failure must release the device and propagate without changing the graphics API');
    }
  } finally {
    if (original) Object.defineProperty(Navigator.prototype, 'gpu', original);
    else delete Navigator.prototype.gpu;
    HTMLCanvasElement.prototype.getContext = getContext;
  }
}
