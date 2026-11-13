import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass} from './shader_fixtures.mjs';

export async function verifyDerivatives(backend,stage) {
  await verifyPixels(backend,stage,stage.cases.map((_,index)=>index),stage.cases);
}

export async function verifyGeometryRoughness(backend,stage) {
  await verifyPixels(backend,stage,[0,0.1,0.9],[[0.4275,0.375,0.25],[0.475,0.375,0.25],[1,0.375,0.25]]);
}

async function verifyPixels(backend,stage,inputs,cases) {
  const errors=[],gpu=await createGpu(error=>errors.push(error));
  if(gpu.backend!==backend) throw new Error(`Expected ${backend}; selected ${gpu.backend}`);
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(8,8).getContext('2d');
  const shader=await gpu.shader(surface,shaderProgram([shaderPass({fragment:stage[backend],...stage.reflection,
    draws:[{count:3,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false,pipeline:0}]})]));
  const quad=[];
  for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*8,y*8,x,y,1,1,1,1);
  const encode=value=>Math.round(255*(value<=0.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-0.055));
  try {
    for(const [mode,color] of cases.entries()) {
      const integer=stage.reflection.uniforms[0].type.scalar==='sint32';
      const words=integer?new Int32Array([inputs[mode],0,0,0]):new Float32Array([inputs[mode],0,0,0]);
      shader.uniformBuffer(0,0,0,integer?1:0,1,1,new Uint8Array(words.buffer));
      const image=shader.render(8,8);
      gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:8,height:8});gpu.present(surface,8,8,1);
      context.drawImage(canvas,0,0);
      for(const [x,y] of [[2,2],[3,2],[2,3],[3,3],[5,5]]) {
        const actual=[...context.getImageData(x,y,1,1).data],expected=[...color.map(encode),255];
        if(actual.some((value,channel)=>Math.abs(value-expected[channel])>4))
          throw new Error(`${backend} derivative mode ${mode} at ${x},${y}: ${actual}; expected ${expected}`);
      }
    }
    if(errors.length) throw errors[0];
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Shader derivatives produced a WebGL error');
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
