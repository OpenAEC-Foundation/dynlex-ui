import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass,shaderImage,shaderColor} from './shader_fixtures.mjs';

export async function verifyEnvironmentSampling(backend,stages) {
  const data=await fetch('/sampling-data.json').then(response=>response.json());
  const errors=[],gpu=await createGpu(error=>errors.push(error));
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(4,4).getContext('2d');
  const draw={count:3,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false,pipeline:0};
  const pass=(key,color)=>shaderPass({fragment:stages[key][backend],...stages[key].reflection,draws:[draw],color});
  const cube={...shaderImage('cube','rgba16float',1,{kind:'fixed',width:4,height:4}),dimension:'cube',layers:6};
  const pixel={kind:'sampler',name:'pixel',minFilter:'nearest',magFilter:'nearest',mipmapFilter:'nearest',
    addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',addressModeW:'clamp-to-edge',compare:'none',lodMinClamp:0,lodMaxClamp:32,maxAnisotropy:1};
  const faces=Array.from({length:6},(_,face)=>{
    const color=shaderColor('cube','load');color.view.layer=face;return pass('scene-cube',color);
  });
  const descriptor=shaderProgram([...faces,pass('environment-dfg',shaderColor('dfg','load')),pass('sampling-query',shaderColor())],
    [cube,shaderImage('dfg','rgba16float',1,{kind:'fixed',width:4,height:4}),pixel]);
  const shader=await gpu.shader(surface,descriptor),quad=[];
  for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*4,y*4,x,y,1,1,1,1);
  const uniform=(pass,values)=>shader.uniformBuffer(pass,0,0,0,1,4,new Uint8Array(new Float32Array(values).buffer));
  const encode=value=>Math.round(255*(value<=0.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-0.055));
  let baked=false;
  const render=()=>{
    const owner=backend==='webgpu'?GPUCommandEncoder.prototype:WebGL2RenderingContext.prototype;
    const method=backend==='webgpu'?'beginRenderPass':'bindFramebuffer';
    const property=Object.getOwnPropertyDescriptor(owner,method),original=owner[method];
    let count=0;
    Object.defineProperty(owner,method,{configurable:true,writable:true,value(...args) {
      if(backend==='webgpu'||args[1]!==null) count++;
      return original.apply(this,args);
    }});
    try {
      const image=shader.render(4,4);
      if(baked&&count!==1) throw new Error(`${backend} static bakes submitted ${count} GPU passes/frame; expected only the query pass`);
      return image;
    } finally {Object.defineProperty(owner,method,property);}
  };
  const query=(values,expected,label)=>{
    uniform(7,values);
    const image=render();
    gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:4,height:4});gpu.present(surface,4,4,1);
    context.drawImage(canvas,0,0);
    const actual=[...context.getImageData(2,2,1,1).data],wanted=[...expected.map(encode),255];
    if(actual.some((value,channel)=>Math.abs(value-wanted[channel])>4))
      throw new Error(`${backend} environment ${label}: ${actual}; expected ${wanted}`);
  };
  try {
    for(let face=0;face<6;face++) uniform(face,[4,4,face,0]);
    uniform(6,[4,4,128,0]);
    query([...data.cube[0].direction,0],data.cube[0].color,'initial cube bake');
    baked=true;
    for(let pass=0;pass<7;pass++) shader.draws(pass,new Uint32Array());
    for(let face=0;face<6;face++) uniform(face,[4,4,(face+1)%6,0]);
    uniform(6,[4,4,1,0]);
    for(const [index,sample] of data.cube.entries()) query([...sample.direction,0],sample.color,`cube texel ${index}`);
    for(const [index,sample] of data.lookup.entries()) query([sample.roughness,sample.cosine,0,1],sample.coefficients,`DFG texel ${index}`);
    if(errors.length) throw errors[0];
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Environment integration produced a WebGL error');
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
