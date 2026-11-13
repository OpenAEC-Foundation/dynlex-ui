import {createGpu} from '/platform/gpu.js';
import {shaderProgram,shaderPass,shaderState,shaderImage,shaderView,shaderColor,shaderDepth} from './shader_fixtures.mjs';

const encode=value=>Math.round(255*(value<=0.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-0.055));
export async function verifyPipelineDraws(backend,stages) {
  const vertex=stages['pipelines-vertex'],fragment=stages['pipelines-fragment'];
  const errors=[],gpu=await createGpu(error=>errors.push(error)),canvas=document.createElement('canvas');
  canvas.width=8;canvas.height=8;
  const surface=gpu.surface(canvas),context=new OffscreenCanvas(8,8).getContext('2d');
  const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
  const pipelines=[shaderState(true,'less',null,'back','ccw'),shaderState(true,'less',null,'back','cw'),
    shaderState(false,'less',blend),shaderState(false,'always'),shaderState(true,'less',null,'front','ccw')];
  // Each prefix starts with one attachment clear. Intermediate expectations expose
  // state leaking between draws, including depth writes hidden by alpha blending.
  const records=[
    [0,.7,[1,0,0,1],false,[1,0,0]],
    [4,.1,[0,1,0,1],false,[1,0,0]],
    [2,.5,[0,0,1,.5],false,[.5,0,.5]],
    [1,.6,[0,1,0,1],false,[.5,0,.5]],
    [0,.8,[1,1,0,1],false,[.5,0,.5]],
    [0,.6,[0,1,0,1],false,[0,1,0]],
    [2,.5,[0,0,1,.5],false,[0,.5,.5]],
    [1,.4,[1,0,0,1],true,[1,0,0]],
    [2,.2,[0,1,0,.25],false,[.75,.25,0]],
    [0,.3,[0,0,1,1],false,[0,0,1]],
    [3,.9,[1,1,0,1],false,[1,1,0]],
    [0,.35,[.25,.5,.75,1],false,[1,1,0]],
    [2,.1,[0,0,1,.5],false,[.5,.5,.5]]
  ];
  const layouts=[{arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}]},
    {arrayStride:16,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x4'}]}];
  const descriptor=shaderProgram([shaderPass({vertex:vertex[backend],fragment:fragment[backend],vertexBuffers:layouts,pipelines,
    color:shaderColor('msaa','clear',[0,0,0,1],shaderView('output'),'discard'),depth:shaderDepth('depth','clear',1,'discard')})],
    [shaderImage('msaa','rgba8unorm-srgb',4),shaderImage('depth','depth24plus',4)]);
  const shader=await gpu.shader(surface,descriptor);
  try {
    const positions=[],colors=[],draws=[],quad=[];
    for(const [index,[pipeline,depth,color,clockwise]] of records.entries()) {
      const points=[[-1,-1],[-1,3],[3,-1]];
      if(clockwise) [points[1],points[2]]=[points[2],points[1]];
      for(const [x,y] of points) positions.push(x,y,depth,1);
      colors.push(...color);
      draws.push(3,1,0,index*3,index,index%2,pipeline);
    }
    shader.vertexBuffer(0,0,new Float32Array(positions));shader.vertexBuffer(0,1,new Float32Array(colors));
    shader.indexBuffer(0,new Uint32Array([0,1,2]));
    for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) quad.push(x*8,y*8,x,y,1,1,1,1);
    for(let length=1;length<=records.length;length++) {
      shader.draws(0,new Uint32Array(draws.slice(0,length*7)));
      const image=shader.render(8,8);
      gpu.begin(surface,[0,0,0]);gpu.triangles(surface,new Float32Array(quad),image,{x:0,y:0,width:8,height:8});gpu.present(surface,8,8,1);
      context.drawImage(canvas,0,0);
      const actual=[...context.getImageData(4,4,1,1).data],expected=[...records[length-1][4].map(encode),255];
      if(actual.some((value,index)=>Math.abs(value-expected[index])>3))
        throw new Error(`${backend} pipeline prefix ${length}: ${actual}; expected ${expected}`);
    }
    shader.draws(0,new Uint32Array([0,1,0,0,0,0,pipelines.length]));
    let rejected=false;
    try {shader.render(8,8);} catch(error) {if(!/pipeline/.test(error.message)) throw error;rejected=true;}
    if(!rejected) throw new Error('An invalid pipeline was accepted for an empty draw');
    shader.draws(0,new Uint32Array(draws));shader.render(8,8);
    if(errors.length) throw errors[0];
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Pipeline draws produced a WebGL API error');
  } finally {shader.close();gpu.releaseSurface(surface);gpu.close();}
}
