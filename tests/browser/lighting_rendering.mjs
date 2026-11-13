import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass} from './shader_fixtures.mjs';

export async function verifyLighting(backend,stages) {
  const {cases}=await fetch('/lighting-reference.json').then(response=>response.json());
  const stage=stages['scene-lighting'],errors=[],gpu=await createGpu(error=>errors.push(error));
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(4,4).getContext('2d');
  const descriptor=shaderProgram([shaderPass({fragment:stage[backend],uniforms:stage.reflection.uniforms,
    glslUniforms:stage.reflection.glslUniforms,draws:[{count:3,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false,pipeline:0}]})]);
  const shader=await gpu.shader(surface,descriptor),quad=[];
  for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*4,y*4,x,y,1,1,1,1);
  const encode=value=>Math.round(255*(value<=0.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-0.055));
  const keys=['ggx','fresnel','dfgView','dfgLight','multiple','hemisphere','environmentSpecular','environmentDiffuse','direct','indirectDiffuse'];
  try {
    for(const [index,sample] of cases.entries()) for(const [mode,key] of keys.entries()) {
      const expected=sample[key],scale=1/(1+Math.max(...expected));
      const inputs=[
        [...sample.normal,sample.roughness],[...sample.view,sample.metalness],[...sample.light,scale],[...sample.specular,mode],
        [...sample.albedo,0],[...sample.sky,0],[...sample.ground,0],[...sample.radiance,0],[...sample.irradiance,0],
        [...sample.dfgView,0],[...sample.dfgLight,0]];
      for(const [binding,values] of inputs.entries())
        shader.uniformBuffer(0,0,binding,0,1,4,new Uint8Array(new Float32Array(values).buffer));
      const image=shader.render(4,4);
      gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:4,height:4});gpu.present(surface,4,4,1);
      context.drawImage(canvas,0,0);
      const actual=[...context.getImageData(2,2,1,1).data],wanted=[...expected.map(value=>encode(value*scale)),255];
      if(actual.some((value,channel)=>Math.abs(value-wanted[channel])>4))
        throw new Error(`${backend} lighting ${index} ${key}: ${actual}; expected ${wanted}`);
    }
    if(errors.length) throw errors[0];
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Physical lighting produced a WebGL error');
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
