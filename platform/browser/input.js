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
  input.readOnly = true;
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.setAttribute('autocorrect', 'off');
  input.wrap = 'off';
  Object.assign(input.style, { position: "fixed", left: "0", top: "0", width: "1px",
    height: "1px", opacity: "0", padding: "0", border: "0", margin: "0", pointerEvents: "none",
    overflow: 'hidden', resize: 'none', fontKerning: 'none' });
  canvas.parentElement.append(input);
  let composing = false;
  let compositionOwner = 0, compositionStart = 0, preedit = '';
  let context = { owner: 0 };
  const ownsFocus = () => document.hasFocus() && [canvas, input].includes(document.activeElement);
  const updateContext = value => {
    const owned = ownsFocus();
    if (value.owner !== context.owner && composing) {
      composing = false;
      if (owned) canvas.focus({ preventScroll: true });
    }
    context = value;
    if (value.owner === 0) {
      if (document.activeElement === input && owned) canvas.focus({ preventScroll: true });
      input.readOnly = true;
      return;
    }
    input.readOnly = false;
    const bounds = canvas.getBoundingClientRect(), box = value.bounds;
    const scale = box.height / (value.font.size + 3);
    Object.assign(input.style, { left: bounds.left + box.x + 'px', top: bounds.top + box.y + 'px',
      height: box.height + 'px', lineHeight: box.height + 'px', fontSize: value.font.size * scale + 'px',
      fontFamily: '"' + value.font.family + '"' });
    if (!composing) {
      if (input.value !== value.text) input.value = value.text;
      const first = Math.min(value.anchor, value.caret), last = Math.max(value.anchor, value.caret);
      const direction = value.anchor > value.caret ? 'backward' : 'forward';
      if (input.selectionStart !== first || input.selectionEnd !== last || input.selectionDirection !== direction)
        input.setSelectionRange(first, last, direction);
      if (owned && document.activeElement !== input) input.focus({ preventScroll: true });
    }
    input.scrollTop = value.line * box.height;
    input.scrollLeft = value.prefix * scale;
  };
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
    event.preventDefault(); canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId); motion(event);
    send(2, 1, 0, 0, modifiers(event));
  }, options);
  canvas.addEventListener("pointerup", event => {
    if (event.button !== 0) return;
    motion(event); send(2, 0, 0, 0, modifiers(event));
    canvas.releasePointerCapture(event.pointerId);
  }, options);
  canvas.addEventListener("pointercancel", () => send(7), options);
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    send(5, 0, event.deltaX * unit, event.deltaY * unit, modifiers(event));
  }, { ...options, passive: false });

  const keydown = event => {
    const key = keyNumber(event.code);
    if (key < 0 || event.isComposing || composing) return;
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
    if ([256, 257, 258, 259, 261, 262, 263, 264, 265, 266, 267, 268, 269].includes(key) ||
        (290 <= key && key <= 314) ||
        (shortcut && [65, 67, 88, 89, 90].includes(key))) event.preventDefault();
    send(event.repeat ? 9 : 3, key, 0, 0, modifiers(event));
  };
  const keyup = event => {
    const key = keyNumber(event.code);
    if (key >= 0) send(6, key, 0, 0, modifiers(event));
  };
  for (const target of [canvas, input]) {
    target.addEventListener('keydown', keydown, options);
    target.addEventListener('keyup', keyup, options);
    target.addEventListener('blur', event => {
      if (![canvas, input].includes(event.relatedTarget)) send(7);
    }, options);
    target.addEventListener('focus', event => {
      if (![canvas, input].includes(event.relatedTarget)) send(14);
    }, options);
  }
  input.addEventListener("paste", event => {
    event.preventDefault(); send(4, 1, 0, 0, 0, event.clipboardData.getData("text/plain"));
  }, options);
  const commit = () => {
    if (composing || context.owner === 0) return;
    const backward = input.selectionDirection === 'backward';
    send(13, context.owner, backward ? input.selectionEnd : input.selectionStart,
      backward ? input.selectionStart : input.selectionEnd, 0, input.value);
  };
  input.addEventListener("input", event => {
    if (event.isComposing && !composing) return;
    if (!composing) { commit(); return; }
    const start = Math.max(0, Math.min(preedit.length, input.selectionStart - compositionStart));
    const end = Math.max(0, Math.min(preedit.length, input.selectionEnd - compositionStart));
    send(10, compositionOwner, start, end, 2, preedit);
  }, options);
  input.addEventListener("compositionstart", () => {
    composing = true; compositionOwner = context.owner; compositionStart = input.selectionStart;
    preedit = ''; send(10, compositionOwner, 0, 0, 1, '');
  }, options);
  input.addEventListener("compositionupdate", event => {
    preedit = event.data; send(10, compositionOwner, preedit.length, preedit.length, 2, preedit);
  }, options);
  input.addEventListener("compositionend", () => {
    if (!composing) return;
    composing = false; send(10, compositionOwner, 0, 0, 0, ''); commit();
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
  document.addEventListener("visibilitychange", () => send(document.hidden ? 7 : (ownsFocus() ? 14 : 8)), options);
  if (document.hidden) send(7);
  window.addEventListener('focus', () => { if (ownsFocus()) send(14); }, options);
  window.addEventListener('blur', () => send(7), options);
  return { updateContext, close() { controller.abort(); observer.disconnect();
    resolution.removeEventListener("change", changed); input.remove(); } };
}
