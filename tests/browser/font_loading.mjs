import assert from 'node:assert/strict';
import {loadFonts} from '../../platform/browser/fonts.js';
const started=[],registered=[],pending=[];
globalThis.document={fonts:{add(face){registered.push(face);}}};
globalThis.FontFace=class {
  constructor(family,source,descriptors){this.family=family;this.source=source;this.descriptors=descriptors;}
  load(){started.push(this);return new Promise((resolve,reject)=>pending.push({resolve:()=>resolve(this),reject}));}
};
const loading=loadFonts([{path:'regular.ttf',source:'family.woff2',weight:400},{path:'bold.ttf',source:'family.woff2',weight:600}],'https://example.invalid/app/');
assert.equal(started.length,2,'Font requests must start together');
pending[1].resolve();assert.equal(registered.length,0);
pending[0].resolve();const faces=await loading;
assert.deepEqual([...faces.keys()],['regular.ttf','bold.ttf']);
assert.equal(faces.get('regular.ttf').face.source,'url("https://example.invalid/app/family.woff2")');
assert.deepEqual(started.map(face=>face.descriptors),[{weight:'400'},{weight:'600'}]);
assert.equal(faces.get('bold.ttf').weight,600);
assert.equal(registered.length,2);
const failed=loadFonts([{path:'broken.ttf',source:'broken.woff2',weight:400}],'https://example.invalid/');
pending.at(-1).reject(new Error('font decode failed'));
await assert.rejects(failed,/font decode failed/);
assert.equal(registered.length,2,'A failed font batch must not register partial faces');
console.log('Required fonts load concurrently with explicit compressed sources and transparent errors.');
