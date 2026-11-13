// Explicit reference recording, using the original renderer's GLSL unchanged.
// Normal test runs read the checked-in values and never regenerate them.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const core=path.resolve(process.env.DYNLEX_CORE),output=process.env.DYNLEX_LIGHTING_REFERENCE_OUTPUT;
assert(output,'Set DYNLEX_LIGHTING_REFERENCE_OUTPUT to the reference JSON destination');
const {ShaderChunk}=await import(pathToFileURL(path.join(core,'web/vendor/three/three.module.min.js')));
function definition(source,name) {
  const match=new RegExp('vec3\\s+'+name+'\\s*\\(|float\\s+'+name+'\\s*\\(').exec(source);
  assert(match,'Missing reference function '+name);
  let cursor=source.indexOf('{',match.index)+1,depth=1;
  while(depth&&cursor<source.length) {if(source[cursor]==='{')depth++;if(source[cursor]==='}')depth--;cursor++;}
  assert.equal(depth,0);
  return source.slice(match.index,cursor);
}
const functions=[ShaderChunk.common,ShaderChunk.lights_physical_pars_fragment,
  definition(ShaderChunk.lights_pars_begin,'getHemisphereLightIrradiance')].join('\n');
const fragment=`#version 300 es
precision highp float;
#define texture2D texture
#define NUM_RECT_AREA_LIGHTS 0
struct HemisphereLight {vec3 direction;vec3 skyColor;vec3 groundColor;};
uniform vec3 normal,view,light,specular,sky,ground,albedo,radiance,irradiance;
uniform float roughness,metalness;
uniform int mode;
out vec4 result;
${functions}
void main(){
 PhysicalMaterial material;material.specularColorBlended=specular;material.specularF90=1.0;material.roughness=roughness;
 material.diffuseColor=albedo;material.diffuseContribution=albedo*(1.0-metalness);material.metalness=metalness;material.specularColor=vec3(0.04);
 vec3 color;
 if(mode==0)color=BRDF_GGX(light,view,normal,material);
 if(mode==1)color=F_Schlick(specular,1.0,clamp(dot(view,normalize(view+light)),0.0,1.0));
 if(mode==2)color=vec3(texture(dfgLUT,vec2(roughness,clamp(dot(normal,view),0.0,1.0))).rg,0.0);
 if(mode==3)color=vec3(texture(dfgLUT,vec2(roughness,clamp(dot(normal,light),0.0,1.0))).rg,0.0);
 if(mode==4)color=BRDF_GGX_Multiscatter(light,view,normal,material);
 if(mode==5){HemisphereLight hemi;hemi.direction=vec3(0,1,0);hemi.skyColor=sky;hemi.groundColor=ground;color=getHemisphereLightIrradiance(hemi,normal);}
 if(mode==6||mode==7){ReflectedLight reflected=ReflectedLight(vec3(0),vec3(0),vec3(0),vec3(0));RE_IndirectSpecular_Physical(radiance,irradiance,vec3(0),vec3(0),normal,view,normal,material,reflected);color=mode==6?reflected.indirectSpecular:reflected.indirectDiffuse;}
 if(mode==8){ReflectedLight reflected=ReflectedLight(vec3(0),vec3(0),vec3(0),vec3(0));IncidentLight incoming;incoming.color=radiance;incoming.direction=light;incoming.visible=true;RE_Direct_Physical(incoming,vec3(0),normal,view,normal,material,reflected);color=reflected.directDiffuse+reflected.directSpecular;}
 if(mode==9){ReflectedLight reflected=ReflectedLight(vec3(0),vec3(0),vec3(0),vec3(0));RE_IndirectDiffuse_Physical(irradiance,vec3(0),normal,view,normal,material,reflected);color=reflected.indirectDiffuse;}
 result=vec4(color,1.0);
}`;
const unit=value=>{const length=Math.hypot(...value);return value.map(component=>Math.fround(component/length));};
const samples=[];
for(const roughness of [0.22,0.5,1]) for(const specular of [[0.04,0.04,0.04],[0.7,0.2,0.05]]) {
  for(const [view,light] of [[[0,1,0],[0,1,0]],[[0.3,0.8,0.6],[-0.5,0.9,0.2]],[[0.99,0.08,0.1],[-0.3,0.9,0.25]]])
    samples.push({normal:[0,1,0],view:unit(view),light:unit(light),specular:specular.map(Math.fround),roughness:Math.fround(roughness)});
}
samples.push({normal:unit([0.2,0.9,0.3]),view:unit([0.5,0.7,1]),light:unit([1,2,-0.5]),specular:[0,0.5,1],roughness:Math.fround(0.0525)});
samples.push({normal:[0,-1,0],view:unit([0.8,-0.2,0]),light:unit([-0.5,-0.4,0.7]),specular:[0,0,0],roughness:Math.fround(0.5)});
const {navigate,evaluate,closeBrowserSession,consoleErrors,runtimeExceptions}=await import(
  pathToFileURL(path.join(core,'tests/web/browser_test_driver.mjs')));
async function record({fragment,samples}) {
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
  if(!gl||!gl.getExtension('EXT_color_buffer_float')) throw new Error('The reference requires float WebGL2 render targets');
  const shader=(kind,source)=>{const result=gl.createShader(kind);gl.shaderSource(result,source);gl.compileShader(result);
    if(!gl.getShaderParameter(result,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));return result;};
  const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nconst vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));void main(){gl_Position=vec4(p[gl_VertexID],0,1);}');
  const pixel=shader(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram();
  gl.attachShader(program,vertex);gl.attachShader(program,pixel);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete reference framebuffer');
  const lut=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,lut);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,2,2,0,gl.RGBA,gl.FLOAT,new Float32Array([.7,.02,0,1,.3,.05,0,1,.4,.1,0,1,.2,.03,0,1]));
  for(const setting of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,setting,gl.NEAREST);
  for(const setting of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,setting,gl.CLAMP_TO_EDGE);
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'dfgLUT'),0);gl.viewport(0,0,1,1);
  const sky=[.7,.8,.9].map(Math.fround),ground=[.2,.1,.05].map(Math.fround),keys=['ggx','fresnel','dfgView','dfgLight','multiple','hemisphere','environmentSpecular','environmentDiffuse','direct','indirectDiffuse'];
  const cases=[];
  try {
    for(const [index,sample] of samples.entries()) {
      const inputs={...sample,sky,ground,albedo:(index%2===0?[.55,.23,.12]:[.09,.4,.8]).map(Math.fround),
        metalness:Math.fround([0,.25,1][index%3]),radiance:[1.3,.4,.9].map(Math.fround),irradiance:[.2,.3,.5].map(Math.fround)};
      for(const [key,value] of Object.entries(inputs)) {
        const location=gl.getUniformLocation(program,key);
        if(Array.isArray(value)) gl.uniform3fv(location,value);else gl.uniform1f(location,value);
      }
      const expected={};
      for(const [mode,key] of keys.entries()) {
        gl.uniform1i(gl.getUniformLocation(program,'mode'),mode);gl.drawArrays(gl.TRIANGLES,0,3);
        const values=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,values);
        if([...values].some(value=>!Number.isFinite(value))) throw new Error('Nonfinite reference result');
        expected[key]=[...values].slice(0,3);
      }
      cases.push({...inputs,...expected});
    }
    if(gl.getError()!==gl.NO_ERROR) throw new Error('Reference rendering produced a GL error');
    return cases;
  } finally {
    gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(pixel);gl.deleteTexture(lut);gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);
  }
}
try {
  await navigate('/');
  const cases=await evaluate(`(${record.toString()})(${JSON.stringify({fragment,samples})})`);
  assert.equal(cases.length,samples.length);assert.deepEqual(consoleErrors,[]);assert.deepEqual(runtimeExceptions,[]);
  const source={renderer:'Existing Farm Three.js ShaderChunk functions',sha256:createHash('sha256').update(functions).digest('hex')};
  await fs.writeFile(output,JSON.stringify({schema:1,source,cases},null,2)+'\n');
  console.log(`Recorded ${cases.length} independent lighting cases from the existing GLSL renderer.`);
} finally {closeBrowserSession();}
