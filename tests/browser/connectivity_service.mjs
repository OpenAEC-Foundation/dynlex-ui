import assert from 'node:assert/strict';
import {createWebServices} from '../../platform/browser/web-services.js';
const target=new EventTarget(),subscribers=new Set(),events=[];
const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
globalThis.addEventListener=(name,listener)=>{subscribers.add(listener);target.addEventListener(name,listener);};
globalThis.removeEventListener=(name,listener)=>{target.removeEventListener(name,listener);subscribers.delete(listener);};
try {
  const service=createWebServices(new URL('https://example.test/')),controller=new AbortController();
  const pending=service.connectivity(null,{signal:controller.signal,emit:event=>events.push(event)});
  assert.deepEqual(events,[{type:'connectivity',online:true}]);
  navigator.onLine=false;target.dispatchEvent(new Event('offline'));
  navigator.onLine=true;target.dispatchEvent(new Event('online'));
  assert.deepEqual(events.map(event=>event.online),[true,false,true]);
  controller.abort();await pending;assert.equal(subscribers.size,0);
  target.dispatchEvent(new Event('offline'));assert.equal(events.length,3);
  assert.throws(()=>service.connectivity(null,{signal:controller.signal,emit:()=>{}}),{name:'AbortError'});
  console.log('Connectivity watches emit initial and changed platform state and release both subscriptions on cancellation.');
} finally {
  if(previous) Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;
  delete globalThis.addEventListener;delete globalThis.removeEventListener;
}
