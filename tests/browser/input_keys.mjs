// Platform normalization owns key transport; editor behavior stays in DynLex.
import assert from 'node:assert/strict';
import {connectInput} from '../../platform/browser/input.js';

class Target extends EventTarget {
  style = {};
  setAttribute() {}
  remove() {}
  getBoundingClientRect() {return {left:0,top:0};}
}
const canvas = new Target(), input = new Target();
canvas.parentElement = {append(value) {assert.equal(value,input);}};
globalThis.document = new Target();
document.createElement = name => {assert.equal(name,'textarea'); return input;};
document.hasFocus = () => true;
document.activeElement = canvas;
document.hidden = false;
globalThis.window = new Target();
globalThis.devicePixelRatio = 1;
globalThis.ResizeObserver = class {observe() {} disconnect() {}};
globalThis.matchMedia = () => new Target();
const events = [];
const connection = connectInput({canvas,title:'Test'},(...args) => events.push(args),() => {});
function key(target,code,options={}) {
  const event = new Event('keydown',{cancelable:true});
  Object.assign(event,{code,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,
    repeat:false,isComposing:false,...options});
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
for (let number=1;number<=25;number++) {
  assert.equal(key(canvas,`F${number}`),true);
  assert.deepEqual(events.at(-1),[3,289+number,0,0,0]);
}
assert.equal(key(input,'ArrowLeft',{altKey:true}),true);
assert.deepEqual(events.at(-1),[3,263,0,0,4]);
assert.equal(key(input,'KeyZ',{ctrlKey:true}),true);
assert.deepEqual(events.at(-1),[3,90,0,0,2]);
assert.equal(key(canvas,'F12',{repeat:true}),true);
assert.deepEqual(events.at(-1),[9,301,0,0,0]);
const count = events.length;
assert.equal(key(input,'F12',{isComposing:true}),false);
assert.equal(key(canvas,'Unrecognized'),false);
assert.equal(events.length,count);
connection.close();
console.log('Browser keys preserve native codes and reserve application function keys.');
