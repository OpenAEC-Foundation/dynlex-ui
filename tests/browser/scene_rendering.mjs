import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass,shaderImage,shaderState,shaderDepth} from './shader_fixtures.mjs';

// CPU-projected points are tested against the actual indexed, instanced GPU image.
export async function verifySceneBuffers() {
  const response=await fetch('/__tests__/scene-buffers.json');
  if(!response.ok) throw new Error('Compiled scene fixtures are missing');
  const {data,stages}=await response.json(),errors=[];
  const gpu=await createGpu(error=>errors.push(error));
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
  const surface=gpu.surface(canvas);
  const shader=await gpu.shader(surface,shaderProgram([shaderPass({vertex:stages.vertex[gpu.backend],fragment:stages.fragment[gpu.backend],
    vertexBuffers:data.layouts,draws:[],uniforms:stages.vertex.reflection.uniforms,
    glslUniforms:[...stages.vertex.reflection.glslUniforms,...stages.fragment.reflection.glslUniforms],
    pipelines:[shaderState(true,'less')],depth:shaderDepth()})],[shaderImage('depth','depth24plus')]));
  const quad=[];
  for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*96,y*96,x,y,1,1,1,1);
  const context=new OffscreenCanvas(96,96).getContext('2d');
  const frame=mode=>{
    shader.uniformBuffer(0,0,1,1,1,1,new Uint8Array(new Int32Array([mode,0,0,0]).buffer));
    const image=shader.render(96,96);
    gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:96,height:96});
    gpu.present(surface,96,96,1);context.drawImage(canvas,0,0);
  };
  const encoded=value=>Math.round(255*(value<=0.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-0.055));
  const expect=(point,linear,label)=>{
    const [x,y]=point.map(Math.floor),actual=[...context.getImageData(x,y,1,1).data],wanted=[...linear.map(encoded),255];
    if(actual.some((channel,index)=>Math.abs(channel-wanted[index])>4))
      throw new Error(`Scene ${label} ${gpu.backend} pixel ${x},${y}: ${actual}; expected ${wanted}`);
  };
  try {
    shader.vertexBuffer(0,0,new Uint32Array(data.vertices));
    shader.vertexBuffer(0,1,new Uint32Array(data.colors));
    shader.vertexBuffer(0,2,new Uint32Array(data.instances));
    shader.indexBuffer(0,new Uint32Array(data.indices));shader.draws(0,new Uint32Array(data.draws));
    shader.uniformBuffer(0,0,0,0,4,4,new Uint8Array(new Uint32Array(data.camera).buffer));
    const red=data.expected[0],green=data.expected[1];
    const decoded=Math.pow((128/255+0.055)/1.055,2.4);
    frame(0);expect(red.screen,[decoded*0.5,0,0],'linear color and depth');expect(green.screen,[0,decoded*0.75,0],'mirrored instance');
    frame(1);for(const item of data.expected) expect(item.screen,item.normal,'inverse-transpose normal');
    frame(2);for(const item of data.expected) expect(item.screen,[1,1,0.25],'exact flags');
    frame(3);for(const item of data.expected) expect(item.screen,[0.25,0.5,item.handedness*0.5+0.5],'material surface');
    frame(4);for(const item of data.expected) expect(item.screen,[0.25,decoded*0.25,0],'linear emission');
    frame(5);for(const item of data.expected) expect(item.screen,[0.25,0.75,1],'UV and opacity');
    frame(6);for(const item of data.expected) expect(item.screen,[1/Math.sqrt(3),0.5,0.5],'shared vector arithmetic');
    frame(7);for(const item of data.expected) expect(item.screen,[0.25,0.5,0.75],'shared vector mutation');
    frame(8);for(const item of data.expected) expect(item.screen,[0.25,0.5,0.75],'zero vector normalization');
    frame(9);for(const item of data.expected) expect(item.screen,item.customNormal,'custom inverse-transpose normal');
    shader.draws(0,new Uint32Array());frame(0);
    for(const item of data.expected) expect(item.screen,[0,0,0],'removed draws');
    shader.draws(0,new Uint32Array(data.draws));frame(0);
    expect(red.screen,[decoded*0.5,0,0],'retained geometry');expect([1,1],[0,0,0],'background');
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Scene buffers produced a WebGL API error');
    if(errors.length) throw errors[0];
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
