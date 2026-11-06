// Font rasterization is a host service. Placement and interaction are DynLex code.
export async function loadFonts(paths, base) {
  const faces = new Map();
  for (const [index, path] of paths.entries()) {
    const family = `DynLexUI${index}`;
    const face = new FontFace(family, `url("${new URL(path, base).href}")`);
    await face.load();
    document.fonts.add(face);
    faces.set(path, { family, face });
  }
  return faces;
}

export function createFontServices(gpu, faces, resources, id) {
  const fonts = new Map();
  const cache = new Map();
  let pixels = 0;
  const maximumPixels = 8 * 1024 * 1024;
  const measure = new OffscreenCanvas(1, 1).getContext("2d");

  function use(context, font, scale = 1) {
    context.font = `${font.size * scale}px "${font.family}"`;
    context.fontKerning = "none";
    context.textBaseline = "alphabetic";
    context.fillStyle = "white";
  }

  function coverage(context, width, height) {
    const rgba = context.getImageData(0, 0, width, height).data;
    const bytes = new Uint8Array(width * height);
    for (let index = 0; index < bytes.length; index++) bytes[index] = rgba[index * 4 + 3];
    return bytes;
  }

  function release(key, entry) {
    cache.delete(key);
    resources.delete(entry.id);
    pixels -= entry.pixels;
    gpu.retire(entry.texture);
  }

  function open(surface, path, size) {
    const { family } = faces.get(path);
    const handle = id();
    fonts.set(handle, { surface, family, size });
    return handle;
  }

  function width(handle, text) {
    use(measure, fonts.get(handle));
    return measure.measureText(text).width;
  }

  function mask(handle, text, scale, clipLeft, clipTop, clipRight, clipBottom) {
    const font = fonts.get(handle);
    use(measure, font);
    const metrics = measure.measureText(text);
    const left = Math.max(Math.floor(clipLeft * scale) - 1, Math.floor(Math.min(0, -metrics.actualBoundingBoxLeft) * scale) - 1);
    const right = Math.min(Math.ceil(clipRight * scale) + 1, Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight) * scale) + 1);
    const top = Math.max(Math.floor(clipTop * scale) - 1, -Math.ceil(metrics.actualBoundingBoxAscent * scale) - 1);
    const bottom = Math.min(Math.ceil(clipBottom * scale) + 1, Math.ceil(metrics.actualBoundingBoxDescent * scale) + 1);
    if (right <= left || bottom <= top) return 0;
    const key = `${handle}:${scale}:${left}:${top}:${right}:${bottom}:${text}`;
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key); cache.set(key, existing);
      return existing.id;
    }
    const width = right - left, height = bottom - top;
    const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
    use(context, font, scale);
    context.fillText(text, -left, -top);
    const resource = gpu.mask(font.surface, coverage(context, width, height), width, height);
    const entry = Object.assign(resource, { id: id(), font: handle, pixels: width * height,
      logicalWidth: width / scale, logicalHeight: height / scale, left: left / scale, top: top / scale });
    resources.set(entry.id, entry); cache.set(key, entry); pixels += entry.pixels;
    return entry.id;
  }

  function trim() {
    while (pixels > maximumPixels && cache.size > 1) {
      const [key, entry] = cache.entries().next().value;
      release(key, entry);
    }
  }

  function close(handle) {
    for (const [key, entry] of cache) if (entry.font === handle) release(key, entry);
    fonts.delete(handle);
  }
  return { open, close, width, mask, trim, coverage };
}
