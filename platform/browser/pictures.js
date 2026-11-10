// Decode/upload and request lifetime only. DynLex owns picture state and layout.
export function createPictureServices({ graphics, surfaces, callback, text, fail, report = console.error }) {
  const pending = new Map();
  function close(image) {
    const entry = pending.get(image);
    pending.delete(image);
    entry.controller.abort();
    if (entry.resource !== 0) graphics.release(entry.resource);
  }
  return {
    closeSurface(surface) {
      for (const [image, entry] of [...pending]) if (entry.surface === surface) close(image);
    },
    imports: {
      ui_open_picture(handle, view, image, done, pointer, count) {
        const entry = { surface: surfaces.get(handle), controller: new AbortController(), resource: 0 };
        if (pending.has(image)) throw new Error('A picture already has a live request');
        const path = text(pointer, count), signal = entry.controller.signal;
        pending.set(image, entry);
        Promise.resolve().then(() => graphics.request({ operation: 'image', path, width: 0, height: 0 },
          { signal }, entry.surface)).then(result => {
          if (signal.aborted) { graphics.release(result.resource); return; }
          entry.resource = result.resource;
          callback(done)(image, view, result.resource, result.width, result.height, 1);
        }, error => {
          if (signal.aborted) return;
          report('DynLex image:', error);
          callback(done)(image, view, 0, 0, 0, 2);
        }).catch(fail);
      },
      ui_close_picture(handle, image) {
        const entry = pending.get(image);
        if (entry.surface !== surfaces.get(handle)) throw new Error('A picture belongs to another surface');
        close(image);
      }
    }
  };
}
