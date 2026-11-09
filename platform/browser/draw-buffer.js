// The shared DynLex vertex ABI and batching are independent of the browser GPU API.
export function createDrawBuffer(canvas) {
  return { canvas, vertices: new Float32Array(4096), used: 0, commands: [], capacity: 0 };
}

export function begin(surface, color) {
  surface.used = 0;
  surface.commands.length = 0;
  surface.clear = { r: color[0], g: color[1], b: color[2], a: 1 };
}

export function triangles(surface, values, texture, clip) {
  if (clip.width <= 0 || clip.height <= 0) return;
  if (surface.used + values.length > surface.vertices.length) {
    const replacement = new Float32Array(Math.max(surface.vertices.length * 2, surface.used + values.length));
    replacement.set(surface.vertices.subarray(0, surface.used));
    surface.vertices = replacement;
  }
  const start = surface.used / 8;
  surface.vertices.set(values, surface.used);
  surface.used += values.length;
  const count = values.length / 8;
  const last = surface.commands.at(-1);
  if (last && last.texture === texture && last.clip.x === clip.x && last.clip.y === clip.y &&
      last.clip.width === clip.width && last.clip.height === clip.height) last.count += count;
  else surface.commands.push({ start, count, texture, clip });
}

export function* clippedCommands(surface, scale) {
  for (const command of surface.commands) {
    const box = command.clip;
    const left = Math.max(0, Math.min(surface.canvas.width, Math.floor(box.x * scale)));
    const top = Math.max(0, Math.min(surface.canvas.height, Math.floor(box.y * scale)));
    const right = Math.max(left, Math.min(surface.canvas.width, Math.ceil((box.x + box.width) * scale)));
    const bottom = Math.max(top, Math.min(surface.canvas.height, Math.ceil((box.y + box.height) * scale)));
    if (right > left && bottom > top) yield { command, left, top, width: right - left, height: bottom - top };
  }
}
