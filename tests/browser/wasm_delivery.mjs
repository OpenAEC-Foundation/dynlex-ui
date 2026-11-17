import assert from 'node:assert/strict';
import {separateWasmNames} from '../../tools/wasm_delivery.mjs';
// An independent hand-encoded module exports a function returning 7.
const code=Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,7,1,3,114,117,110,0,0,10,6,1,4,0,65,7,11]);
const names=Uint8Array.from([0,5,4,110,97,109,101]);
const other=Uint8Array.from([0,5,4,107,101,101,112]);
const input=Uint8Array.from([...code,...names,...other]);
const result=separateWasmNames(input);
assert.deepEqual(result.module,Uint8Array.from([...code,...other]));
assert.deepEqual(result.names,names);
assert(WebAssembly.validate(result.module));
assert.throws(()=>separateWasmNames(Uint8Array.from([0,1,2])),WebAssembly.CompileError);
assert.equal(new WebAssembly.Instance(new WebAssembly.Module(result.module)).exports.run(),7);
assert.deepEqual(separateWasmNames(result.module).module,result.module);
assert.equal(separateWasmNames(result.module).names.length,0);
console.log('Wasm delivery separates debug names while preserving executable code and other metadata.');
