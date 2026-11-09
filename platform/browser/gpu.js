import { requestGraphicsBackend } from "./graphics-backend.js";
import { createWebGpu } from "./gpu-webgpu.js";
import { createWebGl } from "./gpu-webgl.js";
import { createDrawBuffer, begin, triangles } from "./draw-buffer.js";

export async function createGpu(reportError) {
  const { backend, device } = await requestGraphicsBackend();
  const driver = backend === "webgpu" ? await createWebGpu(device, reportError) : createWebGl(reportError);
  return { ...driver, begin, triangles,
    surface(canvas) {
      const surface = Object.assign(driver.surface(canvas), createDrawBuffer(canvas));
      surface.white = driver.mask(surface, new Uint8Array([255]), 1, 1);
      return surface;
    },
    releaseSurface(surface) {
      surface.white.texture.destroy();
      driver.releaseSurface(surface);
    }
  };
}
