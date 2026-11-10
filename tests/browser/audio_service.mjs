import assert from 'node:assert/strict';
import { createAudioServices } from '../../platform/browser/audio.js';
class Parameter {
  constructor(value=0) { this.value=value; this.ramps=[]; }
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value=value; }
  linearRampToValueAtTime(value,time) { this.value=value; this.ramps.push([value,time]); }
}
class Source {
  playbackRate=new Parameter(1); disconnected=false; stopped=false;
  connect() {}
  start(when,offset) { if(offset<0) throw new RangeError('Invalid offset');this.offset=offset; }
  stop() { this.stopped=true; }
  disconnect() { this.disconnected=true; }
  finish() { this.onended?.(); }
}
class Context {
  currentTime=3; destination={}; sources=[]; gains=[]; closed=false;
  async decodeAudioData(bytes) { return {duration:bytes.byteLength}; }
  createBufferSource() { const source=new Source(); this.sources.push(source); return source; }
  createGain() { const node={gain:new Parameter(),connect(){},disconnect(){}}; this.gains.push(node); return node; }
  async resume() {}
  async close() { this.closed=true; }
}
const context=new Context(), downloads=[];
const audio=createAudioServices(new URL('https://example.test/'),{
  createContext:()=>context,
  fetch:async(url,{signal})=>{ downloads.push(String(url)); signal.throwIfAborted(); return {ok:true,arrayBuffer:async()=>new ArrayBuffer(12)}; }
});
const request=(payload,signal=new AbortController().signal)=>audio.services.audio(payload,{signal});
const loaded=await request({operation:'load',urls:['one.mp3','two.mp3']});
assert.deepEqual(downloads,['https://example.test/one.mp3','https://example.test/two.mp3']);
assert.equal(loaded.buffers.length,2);assert.equal(loaded.buffers[0].duration,12);
const abort=new AbortController();
const playing=request({operation:'play',voice:1,buffer:loaded.buffers[0].id,volume:0.4,rate:2,offset:0.25,loop:false},abort.signal);
assert.equal(context.sources[0].playbackRate.value,2);
assert.equal(context.sources[0].offset,0.25);
await assert.rejects(()=>request({operation:'unload',buffers:[loaded.buffers[0].id]}),/playing audio buffer/);
await request({operation:'state',voice:1,volume:0.2,rate:0,fade:0.45});
assert.equal(context.sources[0].playbackRate.value,0);
assert.deepEqual(context.gains[0].gain.ramps.at(-1),[0.2,3.45]);
context.sources[0].finish();
assert.deepEqual(await playing,{ended:true});
assert.equal((await request({operation:'state',voice:1,volume:0,rate:1,fade:0})).ended,true);
await request({operation:'release',voice:1});
assert.equal(context.sources[0].disconnected,true);
await request({operation:'unload',buffers:[loaded.buffers[0].id]});
await assert.rejects(()=>request({operation:'play',voice:9,buffer:loaded.buffers[0].id}),/Unknown audio buffer/);
await assert.rejects(()=>request({operation:'state',voice:1,volume:0,rate:1,fade:0}),/Unknown audio voice/);
const cancelled=new AbortController();
const pending=request({operation:'play',voice:2,buffer:loaded.buffers[1].id,volume:1,rate:1,offset:0,loop:true},cancelled.signal);
cancelled.abort();await assert.rejects(pending,{name:'AbortError'});
assert.equal(context.sources[1].stopped,true);
await assert.rejects(()=>request({operation:'state',voice:2}),/Unknown audio voice/);
const beforeStart=new AbortController();beforeStart.abort();
await assert.rejects(()=>request({operation:'play',voice:8,buffer:loaded.buffers[1].id},beforeStart.signal),{name:'AbortError'});
assert.equal(context.sources.length,2);
const endedAbort=new AbortController();
const endedPending=request({operation:'play',voice:7,buffer:loaded.buffers[1].id,volume:1,rate:1,offset:0,loop:false},endedAbort.signal);
context.sources[2].finish();await endedPending;endedAbort.abort();
await assert.rejects(()=>request({operation:'state',voice:7}),/Unknown audio voice/);
await assert.rejects(()=>request({operation:'play',voice:9,buffer:loaded.buffers[1].id,volume:1,rate:1,offset:-1,loop:false}),/Invalid offset/);
await assert.rejects(()=>request({operation:'state',voice:9}),/Unknown audio voice/);
assert.equal(context.sources.at(-1).disconnected,true);
const owned=request({operation:'play',voice:3,buffer:loaded.buffers[1].id,volume:0,rate:1,offset:0,loop:true});
await audio.close();await owned;
assert.equal(context.closed,true);assert.equal(context.sources.at(-1).stopped,true);
await assert.rejects(()=>request({operation:'load',urls:[]}),/closed/);
console.log('Audio services decode owned buffers, pause/ramp voices, tolerate ended-state races, cancel and close all resources.');
