import assert from 'node:assert/strict';
import {shaderPassHasWork,setShaderPassEnabled} from '../../platform/browser/shader-passes.js';
import {shaderColor,shaderDepth,shaderPass,shaderView} from './shader_fixtures.mjs';

const retained=()=>shaderPass({color:shaderColor('output','load')});
assert.equal(shaderPassHasWork(retained(),[]),false);
assert.equal(shaderPassHasWork(retained(),[{}]),true);
assert.equal(shaderPassHasWork(shaderPass({}),[]),true,'Color clears are observable without draws');
assert.equal(shaderPassHasWork(shaderPass({color:shaderColor('output','load',[0,0,0,1],null,'discard')}),[]),true);
assert.equal(shaderPassHasWork(shaderPass({color:shaderColor('output','load',[0,0,0,1],shaderView('resolved'))}),[]),true);
assert.equal(shaderPassHasWork(shaderPass({color:null,depth:shaderDepth()}),[]),true,'Depth clears are observable without draws');
assert.equal(shaderPassHasWork(shaderPass({color:null,depth:shaderDepth('depth','load',1,'discard')}),[]),true);
assert.equal(shaderPassHasWork(shaderPass({color:null,depth:shaderDepth('depth','load')}),[]),false);
assert.equal(shaderPassHasWork(shaderPass({color:shaderColor('output','load'),depth:shaderDepth('depth','load')}),[]),false);
const pass={enabled:true};
setShaderPassEnabled(pass,false);assert.equal(pass.enabled,false);
setShaderPassEnabled(pass,true);assert.equal(pass.enabled,true);
assert.throws(()=>setShaderPassEnabled(pass,1),/boolean/);
console.log('Empty shader passes preserve clears, resolves and discards; retained attachments require no GPU work.');
