import assert from 'node:assert/strict';
import {createShaderAssets} from '../../platform/browser/shader-assets.js';

const textures=[],samplers=[],retired=[],writes=[];
let failure=null;
const driver={
  texture(description,width,height) {
    if(description.name===failure) throw new Error('GPU allocation failed');
    const value={name:description.name,width,height,id:textures.length};textures.push(value);return value;
  },
  sampler(description) {const value={name:description.name};samplers.push(value);return value;},
  retireTexture(value) {retired.push(value);},
  retireSampler(value) {retired.push(value);},
  write(record,level,layer,bytes) {writes.push({record,level,layer,bytes:bytes.slice()});}
};
const image=(name,size={kind:'frame'})=>({kind:'texture',name,format:'rgba8unorm',dimension:'2d',layers:1,levels:1,samples:1,size});
const descriptions=[image('paint',{kind:'fixed',width:4,height:2}),image('scene'),image('resolved'),
  {...image('sky',{kind:'fixed',width:4,height:4}),dimension:'cube',layers:6,levels:3},
  {kind:'sampler',name:'smooth',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',compare:'none'}];
const assets=createShaderAssets(descriptions,driver);
descriptions[0].size.width=999;
assert.equal(textures.length,2,'Fixed images should allocate once before the first frame');
assert.equal(samplers.length,1,'One declared sampler should be shared by its users');
assert.equal(assets.image('paint').width,4);
assert.equal(assets.image('paint').description.size.width,4,'A caller edit changed the owned image definition');
assert.throws(()=>assets.image('scene'),/physical storage/);
assert.equal(assets.definition('scene').size.kind,'frame','Pipeline layout needs image definitions before the first frame');
assert.throws(()=>{assets.definition('paint').size.width=999;},TypeError,'The owned description must be immutable');
assert.throws(()=>assets.sampler('paint'),/sampler/);
assert.throws(()=>assets.image('missing'),/Unknown/);
const initial=assets.generation;
assets.resize(80,40);
assert(assets.generation>initial);
const before=assets.image('scene').storage,generation=assets.generation;
assets.resize(80,40);
assert.equal(assets.image('scene').storage,before,'An unchanged viewport reallocated its image');
assert.equal(assets.generation,generation);
const bytes=new Uint8Array([1,2,3,4]);
assets.upload('sky',2,5,bytes);bytes.fill(0);
assert.deepEqual([...writes[0].bytes],[1,2,3,4]);
assert.equal(writes[0].layer,5);
assert.throws(()=>assets.upload('sky',3,0,bytes),/level/);
assert.throws(()=>assets.upload('sky',0,6,bytes),/layer/);
assert.throws(()=>assets.upload('sky',0,0,bytes),/extent and format/);
failure='resolved';
assert.throws(()=>assets.resize(160,80),/allocation failed/);
assert.equal(assets.image('scene').storage,before,'Failed allocation discarded the previous complete frame');
assert.equal(assets.image('scene').width,80);
assert.equal(assets.generation,generation,'A failed replacement published a partial resource generation');
assert(retired.some(value=>value.name==='scene'&&value.width===160),'Failed replacement leaked an allocated image');
failure=null;assets.resize(160,80);
assert.equal(assets.image('scene').width,160);
assert(retired.includes(before),'Replaced frame storage was not retired');
assert.equal(assets.image('paint').width,4,'A frame resize changed a fixed-size asset');
assets.close();
assert.equal(new Set(retired).size,textures.length+samplers.length,'Resource lifetime leaked or retired a handle twice');
assert.equal(retired.length,new Set(retired).size);
assert.throws(()=>assets.close(),/closed/);
assert.throws(()=>assets.resize(1,1),/closed/);
assert.throws(()=>createShaderAssets([image('same'),image('same')],driver),/Duplicate/);
assert.throws(()=>createShaderAssets([{...image('bad'),kind:'invalid'}],driver),/kind/);
const acquired=textures.length,disposals=retired.length;
failure='second';
assert.throws(()=>createShaderAssets([
  image('first',{kind:'fixed',width:2,height:2}),
  image('second',{kind:'fixed',width:2,height:2})
],driver),/allocation failed/);
assert.equal(textures.length,acquired+1);
assert.equal(retired.length,disposals+1,'Construction failure leaked earlier allocations');
failure=null;
const targets=createShaderAssets([
  {...image('depth',{kind:'fixed',width:1,height:1}),format:'depth32float'},
  {...image('multisample'),samples:4}
],driver);
targets.resize(8,8);
assert.throws(()=>targets.upload('depth',0,0,new Uint8Array(4)),/Depth shader images/);
assert.throws(()=>targets.upload('multisample',0,0,new Uint8Array(256)),/Multisample/);
targets.close();
assert.equal(retired.length,new Set(retired).size,'An attachment handle was retired twice');
assert.equal(retired.length,textures.length+samplers.length,'An attachment handle was retained');
console.log('Shader assets share immutable resources, replace frame storage transactionally and retire every owned handle once.');
