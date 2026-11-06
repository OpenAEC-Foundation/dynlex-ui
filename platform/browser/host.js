import { createGpu } from "./gpu.js";
import { loadFonts, createFontServices } from "./fonts.js";
import { connectInput } from "./input.js";

export async function createUiHost(root, fontPaths, base, runtime) {
  const surfaces = new Map(), resources = new Map(), drawings = new Map();
  let instance, nextId = 1;
  const id = () => nextId++;
  const memory = runtime.env.__linear_memory;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  const text = (pointer, count) => decoder.decode(new Uint8Array(memory.buffer, pointer, count));
  const cstring = pointer => {
    const bytes = new Uint8Array(memory.buffer);
    let end = pointer; while (bytes[end]) end++;
    return text(pointer, end - pointer);
  };
  function reportError(error) {
    console.error("DynLex UI:", error);
    root.replaceChildren(Object.assign(document.createElement("p"), {
      textContent: "An error occurred. Check the log."
    }));
    for (const surface of surfaces.values()) {
      surface.closed = true;
      if (surface.raf !== null) cancelAnimationFrame(surface.raf);
    }
  }
  const gpu = await createGpu(reportError);
  const faces = await loadFonts(fontPaths, base);
  const fonts = createFontServices(gpu, faces, resources, id);
  const callback = number => instance.exports.__indirect_function_table.get(number);

  function schedule(surface) {
    if (surface.closed || surface.raf !== null || !surface.tick) return;
    surface.raf = requestAnimationFrame(() => {
      surface.raf = null;
      try { if (surface.tick(surface.view) && !surface.closed) schedule(surface); }
      catch (error) { reportError(error); }
    });
  }

  function send(surface, kind = 8, key = 0, x = 0, y = 0, modifiers = 0, value = "") {
    const bytes = encoder.encode(value);
    const pointer = runtime.env.malloc(bytes.length + 1);
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
    try { surface.input(surface.view, kind, key, x, y, modifiers, pointer, bytes.length); }
    finally { runtime.env.free(pointer); }
  }

  function resized(surface) {
    surface.width = surface.canvas.clientWidth;
    surface.height = surface.canvas.clientHeight;
    surface.scale = devicePixelRatio;
    const width = Math.max(1, Math.round(surface.width * surface.scale));
    const height = Math.max(1, Math.round(surface.height * surface.scale));
    if (surface.canvas.width !== width) surface.canvas.width = width;
    if (surface.canvas.height !== height) surface.canvas.height = height;
  }

  const imports = {
    ui_open(width, height, title) {
      const canvas = document.createElement("canvas");
      canvas.tabIndex = 0; canvas.setAttribute("role", "application");
      canvas.setAttribute("aria-label", cstring(title));
      Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
      root.append(canvas);
      const surface = Object.assign(gpu.surface(canvas), {
        title: cstring(title), id: id(), closed: false, raf: null, tick: null
      });
      surfaces.set(surface.id, surface); resized(surface);
      return surface.id;
    },
    ui_close(handle) {
      const surface = surfaces.get(handle);
      surface.closed = true;
      if (surface.raf !== null) cancelAnimationFrame(surface.raf);
      surface.disconnect(); gpu.releaseSurface(surface); surface.canvas.remove(); surfaces.delete(handle);
    },
    ui_poll(handle, width, height, scale, seconds) {
      const surface = surfaces.get(handle); resized(surface);
      const data = new DataView(memory.buffer);
      data.setInt32(width, surface.width, true); data.setInt32(height, surface.height, true);
      data.setFloat64(scale, surface.scale, true); data.setFloat64(seconds, performance.now() / 1000, true);
    },
    ui_begin(handle, red, green, blue) { gpu.begin(surfaces.get(handle), [red, green, blue]); },
    ui_present(handle) {
      const surface = surfaces.get(handle);
      gpu.present(surface, surface.width, surface.height, surface.scale); fonts.trim();
    },
    ui_triangles(handle, pointer, count, texture, x, y, width, height) {
      gpu.triangles(surfaces.get(handle), new Float32Array(memory.buffer, pointer, count * 8),
        texture === 0 ? null : resources.get(texture), { x, y, width, height });
    },
    ui_open_font(handle, path, size) { return fonts.open(surfaces.get(handle), cstring(path), size); },
    ui_close_font(handle) { fonts.close(handle); },
    ui_measure_text(handle, pointer, count) { return fonts.width(handle, text(pointer, count)); },
    ui_text_mask(handle, pointer, count, scale, left, top, right, bottom) {
      return fonts.mask(handle, text(pointer, count), scale, left, top, right, bottom); },
    ui_mask_width(handle) { return resources.get(handle).logicalWidth; },
    ui_mask_height(handle) { return resources.get(handle).logicalHeight; },
    ui_mask_left(handle) { return resources.get(handle).left; },
    ui_mask_top(handle) { return resources.get(handle).top; },
    ui_svg_begin(surface, size) {
      const context = new OffscreenCanvas(size * 4, size * 4).getContext("2d", { willReadFrequently: true });
      context.scale(size / 6, size / 6); context.strokeStyle = "white";
      context.lineWidth = 2; context.lineCap = "round"; context.lineJoin = "round";
      const handle = id(); drawings.set(handle, { context, size, surface: surfaces.get(surface), closed: false });
      return handle;
    },
    ui_svg_operation(handle, kind, x, y, secondX, secondY, endX, endY) {
      const drawing = drawings.get(handle), context = drawing.context;
      if (kind === 0 || kind === 4) {
        context.beginPath(); context.moveTo(x, y); drawing.closed = kind === 4;
      } else if (kind === 1) context.lineTo(x, y);
      else if (kind === 2) context.bezierCurveTo(x, y, secondX, secondY, endX, endY);
      else { if (drawing.closed) context.closePath(); context.stroke(); }
    },
    ui_svg_end(handle) {
      const { context, size, surface } = drawings.get(handle);
      resources.set(handle, gpu.mask(surface, fonts.coverage(context, size * 4, size * 4), size * 4, size * 4));
      drawings.delete(handle); return handle;
    },
    ui_release_texture(handle) { const resource = resources.get(handle);
      resources.delete(handle); gpu.retire(resource.texture); },
    ui_copy(pointer, count) { navigator.clipboard.writeText(text(pointer, count)).catch(reportError); },
    ui_cursor(handle, shape) { surfaces.get(handle).canvas.style.cursor = ["default", "pointer", "text"][shape]; },
    ui_wake(handle) { schedule(surfaces.get(handle)); },
    ui_launch(handle, view, tick, dispose, input) {
      const surface = surfaces.get(handle);
      Object.assign(surface, { view, tick: callback(tick), dispose: callback(dispose), input: callback(input) });
      surface.disconnect = connectInput(surface, (...args) => send(surface, ...args), () => schedule(surface));
      schedule(surface);
    }
  };
  return { imports, attach(value) { instance = value; },
    close() {
      for (const surface of [...surfaces.values()]) surface.dispose(surface.view);
      for (const { face } of faces.values()) document.fonts.delete(face);
      gpu.close();
    } };
}
