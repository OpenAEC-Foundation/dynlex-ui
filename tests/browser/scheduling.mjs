import assert from 'node:assert/strict';
import { createUiScheduling } from '../../platform/browser/scheduling.js';
let hidden=false,sequence=0,ticks=0;
const frames=new Map(),microtasks=[];
const scheduling=createUiScheduling({hidden:()=>hidden,
  frame:fn=>{const id=sequence++;frames.set(id,fn);return id;},
  cancelFrame:id=>frames.delete(id),enqueue:fn=>microtasks.push(fn),error:error=>{throw error;}});
const surface={closed:false,raf:null,background:null,tick:()=>{ticks++;return true;},view:1};
scheduling.schedule(surface);scheduling.schedule(surface);
assert.equal(frames.size,1);
hidden=true;scheduling.schedule(surface);
assert.equal(frames.size,0,'A frozen animation frame retained the hidden input');
assert.equal(microtasks.length,1);
scheduling.schedule(surface);assert.equal(microtasks.length,1);
microtasks.shift()();assert.equal(ticks,1);
assert.equal(frames.size,0);assert.equal(microtasks.length,0,'Hidden animation kept polling');
scheduling.schedule(surface);scheduling.cancel(surface);microtasks.shift()();assert.equal(ticks,1);
scheduling.schedule(surface);hidden=false;microtasks.shift()();
assert.equal(ticks,2);assert.equal(frames.size,1,'Returning to a visible surface did not resume animation');
scheduling.cancel(surface);assert.equal(frames.size,0);
hidden=true;scheduling.schedule(surface);surface.closed=true;microtasks.shift()();assert.equal(ticks,2);
console.log('Hidden surfaces consume queued events once, cancel frozen frames, resume visible animation and never poll in the background.');
