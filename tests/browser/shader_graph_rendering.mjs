import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass,shaderState,shaderImage,shaderView,shaderColor,shaderDepth} from './shader_fixtures.mjs';
import {verifyRendering,verifyShaderBuffers,verifyShaderUniforms,verifyCompiledShaderUniforms} from './rendering.mjs';
import {verifySceneBuffers} from './scene_rendering.mjs';
import {verifyPipelineDraws} from './pipeline_rendering.mjs';

const draw=count=>({count,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false,pipeline:0});
const layout={arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}]};
const encode=value=>Math.round(255*(value<=0.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-0.055));
function check(actual,linear,label) {
  const expected=[...linear.map(encode),255];
  if(actual.some((value,index)=>Math.abs(value-expected[index])>4)) throw new Error(`${label}: ${actual}; expected ${expected}`);
}
function metadata(...stages) {
  const arrays={uniforms:[],resources:[],glslBindings:[],glslUniforms:[]};
  for(const stage of stages) for(const key of Object.keys(arrays)) for(const value of stage.reflection[key]) {
    if(!arrays[key].some(entry=>JSON.stringify(entry)===JSON.stringify(value))) arrays[key].push(value);
  }
  return arrays;
}
async function verify(backend,fixture,stages) {
  const vertex=stages['graph-vertex'],post=stages['graph-post'];
  const errors=[],gpu=await createGpu(error=>errors.push(error));
  if(gpu.backend!==backend) throw new Error(`Selected ${gpu.backend}; expected ${backend}`);
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(32,32).getContext('2d');
  const descriptor=shaderProgram([
    shaderPass({vertex:vertex[backend],fragment:null,vertexBuffers:[layout],draws:[draw(6)],
      ...metadata(vertex),color:null,depth:shaderDepth('shadow','clear',0.25),pipelines:[shaderState(true,'always')]}),
    shaderPass({vertex:vertex[backend],fragment:fixture[backend],vertexBuffers:[layout],draws:[draw(3)],
      ...metadata(vertex,fixture),color:shaderColor('msaa','clear',[0,0,0,1],shaderView('scene'),'discard'),
      depth:shaderDepth('depth','clear',1,'discard'),pipelines:[shaderState(true,'less',null,'back','ccw')]}),
    shaderPass({fragment:post[backend],draws:[draw(3)],...metadata(post)})
  ],[...fixture.assets,shaderImage('msaa','rgba16float',4),shaderImage('depth','depth24plus',4)]);
  const shader=await gpu.shader(surface,descriptor);
  const values={uv:[0.25,0.25],direction:[1,0,0],level:[0],reference:[0.5],mode:[0]};
  const uniform=(pass,entry,data)=>shader.uniformBuffer(pass,entry.group,entry.binding,0,entry.type.rows,entry.type.columns,
    new Uint8Array(new Float32Array([...data,...new Array(4-data.length).fill(0)]).buffer));
  const frame=(size=16)=>{
    canvas.width=size;canvas.height=size;
    for(const [pass,description] of descriptor.passes.entries()) for(const entry of description.uniforms)
      uniform(pass,entry,entry.name==='vertex_shift'?[0]:entry.name==='width'||entry.name==='height'?[size]:values[entry.name]);
    const image=shader.render(size,size),quad=[];
    for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*size,y*size,x,y,1,1,1,1);
    gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:size,height:size});
    gpu.present(surface,size,size,1);context.drawImage(canvas,0,0);
    return [...context.getImageData(size/2,size/2,1,1).data];
  };
  try {
    shader.vertexBuffer(0,0,new Float32Array([0,-1,0.75,1,0,1,0.75,1,1,1,0.75,1,0,-1,0.75,1,1,1,0.75,1,1,-1,0.75,1]));
    // Clockwise Vulkan clip vertices become counterclockwise in the WebGPU stage.
    shader.vertexBuffer(1,0,new Float32Array([-1,-1,0.5,1,-1,3,0.5,1,3,-1,0.5,1]));
    shader.imageBytes('paint',0,0,new Uint8Array([255,0,0,255,0,0,0,255,0,0,0,255,255,0,0,255]));
    shader.imageBytes('ink',0,0,new Uint8Array([128,0,0,255]));
    shader.imageBytes('hdr',0,0,new Uint8Array(new Uint16Array([0x4000,0xbc00,0x3c00,0x3c00]).buffer));
    for(let face=0;face<6;face++) for(let level=0;level<2;level++) {
      const half=new Uint16Array((level===0?4:1)*4);
      for(let pixel=0;pixel<half.length;pixel+=4) half.set([level===0?0x3400:0x3800,0,0,0x3c00],pixel);
      shader.imageBytes('sky',level,face,new Uint8Array(half.buffer));
    }
    check(frame(),[1,1,0],backend+' independent samplers/culling');
    values.uv=[0.5,0.25];check(frame(),[0,0.5,0],backend+' linear filtering');
    values.mode=[1];values.level=[1];check(frame(),[0.5,0,0],backend+' cube mip');
    values.mode=[2];values.level=[0];values.uv=[0.25,0.5];check(frame(),[0,0,0],backend+' cleared shadow');
    values.uv=[0.75,0.5];check(frame(),[1,1,1],backend+' rendered shadow');
    values.uv=[0.5,0.5];check(frame(),[0.5,0.5,0.5],backend+' shadow PCF');
    values.mode=[3];check(frame(),[Math.pow((128/255+0.055)/1.055,2.4),0,0],backend+' sRGB source');
    values.mode=[4];check(frame(),[0.5,0.25,0.25],backend+' signed HDR');
    values.mode=[0];values.uv=[0.25,0.25];check(frame(24),[1,1,0],backend+' resized graph');
    check(frame(8),[1,1,0],backend+' fixed assets after resize');
    // Exercise the opposite cull mode with the same translated vertex winding.
    descriptor.passes[1].pipelines[0].cullMode='front';
    const culled=await gpu.shader(surface,descriptor);
    try {
      culled.vertexBuffer(0,0,new Float32Array());culled.draws(0,new Uint32Array());
      culled.vertexBuffer(1,0,new Float32Array([-1,-1,0.5,1,-1,3,0.5,1,3,-1,0.5,1]));
      for(const [pass,description] of descriptor.passes.entries()) for(const entry of description.uniforms)
        culled.uniformBuffer(pass,entry.group,entry.binding,0,entry.type.rows,entry.type.columns,
          new Uint8Array(new Float32Array(entry.name==='vertex_shift'?[0,0,0,0]:[8,8,0,0]).buffer));
      const image=culled.render(8,8),quad=[];
      for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*8,y*8,x,y,1,1,1,1);
      gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:8,height:8});gpu.present(surface,8,8,1);
      context.drawImage(canvas,0,0);check([...context.getImageData(4,4,1,1).data],[0,0,0],backend+' front culling');
    } finally {culled.close();}
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Shader graph produced a WebGL API error');
    if(errors.length) throw errors[0];
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
async function verifyOrientation(backend,stages) {
  const errors=[],gpu=await createGpu(error=>errors.push(error)),canvas=document.createElement('canvas');
  canvas.width=16;canvas.height=16;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(16,16).getContext('2d');
  const pattern=stages['graph-pattern'],post=stages['graph-post'];
  const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
  const program=shaderProgram([
    shaderPass({fragment:pattern[backend],draws:[],...metadata(pattern),color:shaderColor('scene','clear',[0.25,0.5,0.75,1])}),
    shaderPass({fragment:pattern[backend],draws:[draw(3)],...metadata(pattern),color:shaderColor('scene','load'),
      depth:shaderDepth(),pipelines:[shaderState(false,'less',blend)]}),
    shaderPass({fragment:post[backend],draws:[draw(3)],...metadata(post)})
  ],[shaderImage('scene','rgba16float'),shaderImage('depth','depth24plus'),{kind:'sampler',name:'pixel',minFilter:'nearest',magFilter:'nearest',mipmapFilter:'nearest',
    addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',addressModeW:'clamp-to-edge',compare:'none',lodMinClamp:0,lodMaxClamp:32,maxAnisotropy:1}]);
  const shader=await gpu.shader(surface,program);
  try {
    for(const [pass,description] of program.passes.entries()) for(const uniform of description.uniforms)
      shader.uniformBuffer(pass,uniform.group,uniform.binding,0,1,1,new Uint8Array(new Float32Array([uniform.name==='opacity'?0.5:16,0,0,0]).buffer));
    const image=shader.render(16,16),quad=[];
    for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*16,y*16,x,y,1,1,1,1);
    gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:16,height:16});gpu.present(surface,16,16,1);
    context.drawImage(canvas,0,0);
    for(const [x,y] of [[2,3],[12,3],[2,12],[12,12]])
      check([...context.getImageData(x,y,1,1).data],[0.125+(x+0.5)/32,0.25+(y+0.5)/32,0.375],backend+' preserved HDR alpha and rendered texture orientation');
    if(errors.length) throw errors[0];
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
async function verifyInterfaces(backend,stages) {
  const vertex=stages['interfaces-vertex'],fragment=stages['interfaces-fragment'];
  const errors=[],gpu=await createGpu(error=>errors.push(error));
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(32,32).getContext('2d');
  const buffers=[
    {arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}]},
    {arrayStride:4,stepMode:'vertex',attributes:[{shaderLocation:1,offset:0,format:'float32'}]},
    {arrayStride:4,stepMode:'vertex',attributes:[{shaderLocation:2,offset:0,format:'uint32'}]},
    {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:3,offset:0,format:'sint32x2'}]}
  ];
  // Different clip W makes perspective interpolation differs from flat values.
  const positions=[[-1,-1,0.5,1],[-2,6,1,2],[12,-4,2,4]];
  try {
    for(const winding of ['ccw','cw']) for(const indexed of [false,true]) {
      const state={...shaderState(),frontFace:winding};
      const program=shaderProgram([shaderPass({vertex:vertex[backend],fragment:fragment[backend],
        vertexBuffers:buffers,draws:[{...draw(3),indexed,first:indexed?1:0}],pipelines:[state],...metadata(vertex,fragment)})]);
      const shader=await gpu.shader(surface,program);
      try {
        shader.vertexBuffer(0,0,new Float32Array(positions.flat()));
        shader.vertexBuffer(0,1,new Float32Array([0.25,0.5,1]));
        shader.vertexBuffer(0,2,new Uint32Array([4294967295,0,0]));
        shader.vertexBuffer(0,3,new Int32Array([-9,12,-8,0,-7,1]));
        if(indexed) shader.indexBuffer(0,new Uint32Array([99,0,1,2,99]));
        const quad=[];
        for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*32,y*32,x,y,1,1,1,1);
        for(let mode=0;mode<2;mode++) {
          shader.uniformBuffer(0,0,0,1,1,1,new Uint8Array(new Int32Array([mode,0,0,0]).buffer));
          const image=shader.render(32,32);
          gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:32,height:32});gpu.present(surface,32,32,1);
          context.drawImage(canvas,0,0);
          for(const [x,y] of [[4,6],[15,17],[25,12]]) {
            const second=(y+0.5)/64,third=(x+0.5)/64,first=1-second-third;
            const blue=mode===0?(first*0.25+second*0.25+third*0.25)/(first+second/2+third/4):
              0.25;
            check([...context.getImageData(x,y,1,1).data],[0.5,winding==='ccw'?0.75:0.125,blue],
              backend+' typed subset, signed/unsigned, face '+winding+' indexed '+indexed+' interpolation '+mode);
          }
        }
      } finally {shader.close();}
    }
    if(errors.length) throw errors[0];
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Typed interfaces produced a WebGL API error');
  } finally {gpu.releaseSurface(surface);gpu.close();}
}
async function verifyToneMapping(backend,stages) {
  const fragment=stages['scene-tone'],cases=await fetch('/tone-reference.json').then(response=>response.json());
  const errors=[],gpu=await createGpu(error=>errors.push(error)),canvas=document.createElement('canvas');
  canvas.width=4;canvas.height=4;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(4,4).getContext('2d');
  const shader=await gpu.shader(surface,shaderProgram([shaderPass({fragment:fragment[backend],draws:[draw(3)],...metadata(fragment)})]));
  try {
    const quad=[];
    for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*4,y*4,x,y,1,1,1,1);
    for(const {color,exposure,expected} of cases) {
      shader.uniformBuffer(0,0,0,0,1,4,new Uint8Array(new Float32Array([...color,exposure]).buffer));
      const image=shader.render(4,4);
      gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:4,height:4});gpu.present(surface,4,4,1);
      context.drawImage(canvas,0,0);
      check([...context.getImageData(2,2,1,1).data],expected,backend+' ACES radiance '+color+' exposure '+exposure);
    }
    if(errors.length) throw errors[0];
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
export async function verifyShaderGraph() {
  const [fixture,stages]=await Promise.all(['resources','graph'].map(name=>fetch(`/${name}.json`).then(response=>response.json())));
  const original=Object.getOwnPropertyDescriptor(Navigator.prototype,'gpu');
  try {
    await verify('webgpu',fixture,stages);
    await verifyOrientation('webgpu',stages);
    await verifyInterfaces('webgpu',stages);
    await verifyToneMapping('webgpu',stages);
    await verifyPipelineDraws('webgpu',stages);
    await verifyRendering();await verifyShaderBuffers();await verifyShaderUniforms();await verifyCompiledShaderUniforms();await verifySceneBuffers();
    Object.defineProperty(Navigator.prototype,'gpu',{configurable:true,get:()=>undefined});
    await verify('webgl',fixture,stages);
    await verifyOrientation('webgl',stages);
    await verifyInterfaces('webgl',stages);
    await verifyToneMapping('webgl',stages);
    await verifyPipelineDraws('webgl',stages);
    const originalExtension=WebGL2RenderingContext.prototype.getExtension;
    try {
      WebGL2RenderingContext.prototype.getExtension=function(name) {
        return name==='WEBGL_provoking_vertex'?null:originalExtension.call(this,name);
      };
      await verifyInterfaces('webgl',stages);
      await verifyPipelineDraws('webgl',stages);
    } finally {WebGL2RenderingContext.prototype.getExtension=originalExtension;}
    await verifyRendering();await verifyShaderBuffers();await verifyShaderUniforms();await verifyCompiledShaderUniforms();await verifySceneBuffers();
    return ['webgpu','webgl'];
  } finally {if(original) Object.defineProperty(Navigator.prototype,'gpu',original);else delete Navigator.prototype.gpu;}
}
