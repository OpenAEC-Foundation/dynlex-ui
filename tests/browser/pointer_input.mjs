import assert from 'node:assert/strict';
import { connectInput } from '../../platform/browser/input.js';

class Element extends EventTarget {
  style = {};
  captures = new Set();
  parentElement = { append() {} };
  setAttribute() {}
  focus() { document.activeElement = this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 10, top: 20 }; }
  remove() {}
}
globalThis.document = Object.assign(new EventTarget(), {
  hidden: false, createElement: () => new Element(), hasFocus: () => true
});
globalThis.window = new EventTarget();
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.matchMedia = () => new EventTarget();
globalThis.devicePixelRatio = 2;
const canvas = new Element(), events = [];
const connection = connectInput({ canvas, title: 'Pointer test' }, (...event) => events.push(event), () => {});
function pointer(type, button, buttons = type === 'pointerup' ? 0 : 1) {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    button, buttons, pointerId: 1, clientX: 40, clientY: 60
  });
  canvas.dispatchEvent(event);
  return event;
}
for (const button of [0, 2, 1]) {
  assert.equal(pointer('pointerdown', button).defaultPrevented, true);
  assert.equal(canvas.hasPointerCapture(1), true);
  pointer('pointerup', button);
  assert.equal(canvas.hasPointerCapture(1), false);
}
assert.deepEqual(events.filter(event => event[0] === 2).map(event => event[1]), [1, 0, 3, 2, 5, 4]);
assert.ok(events.filter(event => event[0] === 1).every(event => event[2] === 30 && event[3] === 40));
pointer('pointerdown', 0, 1);
pointer('pointerdown', 2, 3);
pointer('pointerup', 2, 1);
assert.equal(canvas.hasPointerCapture(1), true, 'Releasing one button must retain another button’s capture.');
pointer('pointerup', 0, 0);
assert.equal(canvas.hasPointerCapture(1), false);
const menu = new Event('contextmenu', { cancelable: true });
canvas.dispatchEvent(menu);
assert.equal(menu.defaultPrevented, true);
connection.close();
console.log('Primary, secondary and middle pointers share native button identities and capture.');
