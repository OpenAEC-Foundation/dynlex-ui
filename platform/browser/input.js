// Normalize browser events into the same stream as the native GLFW adapter.
const keys = new Map(Object.entries({ Escape: 256, Enter: 257, Tab: 258, Backspace: 259,
  Insert: 260, Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264,
  ArrowUp: 265, PageUp: 266, PageDown: 267, Home: 268, End: 269, Space: 32,
  ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343,
  ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347 }));

function keyNumber(code) {
  if (keys.has(code)) return keys.get(code);
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^F([1-9]|1[0-9]|2[0-5])$/.test(code)) return 289 + Number(code.slice(1));
  return -1;
}

export function connectInput(surface, send, schedule) {
  const { canvas } = surface;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", `${surface.title} keyboard input`);
  input.tabIndex = -1;
  Object.assign(input.style, { position: "fixed", left: "0", top: "0", width: "1px",
    height: "1px", opacity: "0", padding: "0", border: "0", pointerEvents: "none" });
  canvas.parentElement.append(input);
  let composing = false;
  const modifiers = event => Number(event.shiftKey) | Number(event.ctrlKey) << 1 |
    Number(event.altKey) << 2 | Number(event.metaKey) << 3;
  const motion = event => {
    const box = canvas.getBoundingClientRect();
    send(1, 0, event.clientX - box.left, event.clientY - box.top, modifiers(event));
  };
  canvas.addEventListener("pointermove", motion, options);
  canvas.addEventListener("pointerleave", event => {
    if (!canvas.hasPointerCapture(event.pointerId)) send(1, 0, -1, -1, modifiers(event));
  }, options);
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault(); input.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId); motion(event);
    send(2, 1, 0, 0, modifiers(event));
  }, options);
  canvas.addEventListener("pointerup", event => {
    if (event.button !== 0) return;
    motion(event); send(2, 0, 0, 0, modifiers(event));
    canvas.releasePointerCapture(event.pointerId);
  }, options);
  canvas.addEventListener("pointercancel", () => send(7), options);
  canvas.addEventListener("focus", () => input.focus({ preventScroll: true }), options);
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    send(5, 0, event.deltaX * unit, event.deltaY * unit, modifiers(event));
  }, { ...options, passive: false });

  input.addEventListener("keydown", event => {
    const key = keyNumber(event.code);
    if (key < 0 || event.isComposing) return;
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
    if ([256, 257, 258, 259, 261, 262, 263, 264, 265, 268, 269].includes(key) ||
        (shortcut && [65, 67, 88].includes(key))) event.preventDefault();
    send(event.repeat ? 9 : 3, key, 0, 0, modifiers(event));
  }, options);
  input.addEventListener("keyup", event => {
    const key = keyNumber(event.code);
    if (key >= 0) send(6, key, 0, 0, modifiers(event));
  }, options);
  input.addEventListener("blur", () => send(7), options);
  input.addEventListener("paste", event => {
    event.preventDefault(); send(4, 0, 0, 0, 0, event.clipboardData.getData("text/plain"));
  }, options);
  const commit = () => {
    if (!composing && input.value) { send(4, 0, 0, 0, 0, input.value); input.value = ""; }
  };
  input.addEventListener("input", commit, options);
  input.addEventListener("compositionstart", () => { composing = true; }, options);
  input.addEventListener("compositionupdate", event => send(10, 0, 0, 0, 0, event.data), options);
  input.addEventListener("compositionend", () => {
    composing = false; send(10, 0, 0, 0, 0, ""); commit();
  }, options);
  const observer = new ResizeObserver(schedule);
  observer.observe(canvas);
  let resolution;
  const changed = () => {
    resolution?.removeEventListener("change", changed);
    resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    resolution.addEventListener("change", changed, { once: true }); schedule();
  };
  changed();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) send(8); }, options);
  return () => { controller.abort(); observer.disconnect();
    resolution.removeEventListener("change", changed); input.remove(); };
}
