import { createGpu } from '/platform/gpu.js';

// Pixel checks use the public submission ABI, independent of application layout.
export async function verifyRendering() {
  const errors = [];
  const gpu = await createGpu(error => errors.push(error));
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 72;
  const surface = gpu.surface(canvas);
  const mask = gpu.mask(surface, new Uint8Array(6).fill(128), 3, 2);
  const image = gpu.image(surface, new Uint8Array([255, 0, 0, 128]), 1, 1);
  const shader = await gpu.shader(surface, { passes: [{ vertex: null, vertexBuffers: [], draws: [{count:3,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false}], uniforms: [], depth: false,
    blend: 'opaque', topology: 'triangle-list', fragment: gpu.backend === 'webgpu'
      ? '@fragment fn main() -> @location(0) vec4f { return vec4f(0,0,1,1); }'
      : '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0,0,1,1);}'
  }, { vertex: gpu.backend === 'webgpu'
      ? '@vertex fn main(@location(0) position: vec4f) -> @builtin(position) vec4f { return position; }'
      : '#version 300 es\nlayout(location=0) in vec4 position;void main(){gl_Position=position;}',
    vertexBuffers: [{arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}]}],
    draws: [{count:3,instances:1,first:0,vertexOffset:0,instanceOffset:0,indexed:false}],
    uniforms: [{ name: 'gain', group: 1, binding: 5 }], depth: true, blend: 'additive', topology: 'triangle-list',
    fragment: gpu.backend === 'webgpu'
      ? '@group(1) @binding(5) var<uniform> gain:vec4f;@fragment fn main()->@location(0) vec4f{return vec4f(gain.x,0,0,0);}'
      : '#version 300 es\nprecision highp float;layout(std140) uniform Settings{vec4 _group_1_binding_5_fs;};out vec4 color;void main(){color=vec4(_group_1_binding_5_fs.x,0,0,0);}'
  }] });
  shader.vertexBuffer(1, 0, new Float32Array([-1,-1,0,1, 3,-1,0,1, -1,3,0,1]));
  const rendered = shader.render(5, 3, [{}, { gain: 0.25 }]);
  const clip = { x: -3, y: 4, width: 43, height: 24 };
  const box = (left, top, width, height, value, alpha, texture, bounds) => {
    const vertices = [];
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      vertices.push(left + x * width, top + y * height, x, y, value, value, value, alpha);
    }
    gpu.triangles(surface, new Float32Array(vertices), texture, bounds);
  };
  try {
    gpu.begin(surface, [0, 0, 0]);
    box(0, 0, 64, 48, 0.25, 1, null, clip);
    box(8, 8, 16, 16, 1, 0.5, null, clip);
    box(28, 8, 8, 16, 1, 1, mask, clip);
    box(48, 28, 12, 12, 1, 1, image, { x: 0, y: 0, width: 64, height: 48 });
    box(48, 4, 12, 12, 1, 1, rendered, { x: 0, y: 0, width: 64, height: 48 });
    gpu.present(surface, 64, 48, 1.5);
    const context = new OffscreenCanvas(96, 72).getContext('2d');
    context.drawImage(canvas, 0, 0);
    const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    const expected = (x, y, value) => {
      const actual = pixel(x, y);
      if (actual.slice(0, 3).some(channel => Math.abs(channel - value) > 3) || actual[3] !== 255) {
        throw new Error(`Pixel ${x},${y}: ${actual}; expected ${value},${value},${value},255`);
      }
    };
    expected(3, 3, 0);       // Top scissor edge.
    expected(3, 9, 137);     // Linear 0.25 encoded to sRGB.
    expected(18, 18, 207);   // 50% white blended over linear 0.25.
    expected(48, 18, 207);   // Odd-width R8 texture, first row.
    expected(48, 30, 207);   // Odd-width R8 texture, second row.
    expected(65, 18, 0);     // Right scissor edge.
    expected(18, 45, 0);     // Bottom scissor edge.
    const red = pixel(78, 48);
    if (Math.abs(red[0] - 188) > 3 || red[1] !== 0 || red[2] !== 0 || red[3] !== 255)
      throw new Error(`RGBA texture color or alpha was lost: ${red}`);
    const purple = pixel(78, 12);
    if (Math.abs(purple[0] - 137) > 3 || purple[1] !== 0 || purple[2] !== 255)
      throw new Error(`Shader passes, geometry, uniform groups or texture composition failed: ${purple}`);
    if (surface.gl && surface.gl.getError() !== surface.gl.NO_ERROR) throw new Error('WebGL rendering produced an API error');
    if (errors.length) throw errors[0];
  } finally {
    gpu.retire(mask.texture);
    gpu.retire(image.texture);
    shader.close();
    gpu.releaseSurface(surface);
    gpu.close();
  }
}

export async function verifyFailureBoundaries() {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'gpu');
  const getContext = HTMLCanvasElement.prototype.getContext;
  let webGlRequests = 0, destroyed = false;
  const failure = new Error('A rendering pipeline failed after device selection');
  const device = { addEventListener() {}, lost: new Promise(() => {}),
    createShaderModule() { return {}; },
    createBindGroupLayout() { return {}; }, createPipelineLayout() { return {}; },
    async createRenderPipelineAsync() { throw failure; },
    destroy() { destroyed = true; } };
  const use = gpu => Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => gpu });
  try {
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === 'webgl2') { webGlRequests++; return null; }
      return getContext.call(this, kind, ...args);
    };
    use(undefined);
    const gpu = await createGpu(error => { throw error; });
    let unavailable = false;
    try { gpu.surface(document.createElement('canvas')); }
    catch (error) { unavailable = error.message.includes('Neither a WebGPU device nor a WebGL2 context'); }
    finally { gpu.close(); }
    if (!unavailable) throw new Error('A browser with neither graphics API must fail explicitly');
    const before = webGlRequests;
    use({ async requestAdapter() { return { async requestDevice() { return device; } }; },
      getPreferredCanvasFormat() { return 'bgra8unorm'; } });
    let rejected = false;
    try { await createGpu(error => { throw error; }); }
    catch (error) { rejected = error === failure; }
    if (!rejected || !destroyed || webGlRequests !== before) {
      throw new Error('A pipeline failure must release the device and propagate without changing the graphics API');
    }
  } finally {
    if (original) Object.defineProperty(Navigator.prototype, 'gpu', original);
    else delete Navigator.prototype.gpu;
    HTMLCanvasElement.prototype.getContext = getContext;
  }
}

export async function verifyShaderBuffers() {
  const errors=[],gpu=await createGpu(error=>errors.push(error));
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
  const surface=gpu.surface(canvas);
  const layouts=[
    {arrayStride:16,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'}]},
    {arrayStride:24,stepMode:'instance',attributes:[{shaderLocation:2,offset:0,format:'float32x2'},{shaderLocation:3,offset:8,format:'float32x3'},{shaderLocation:4,offset:20,format:'uint32'}]},
    {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:5,offset:0,format:'sint32x2'}]}
  ];
  const vertex=gpu.backend==='webgpu' ? `
    @group(0) @binding(0) var<uniform> minimumVertex:vec4f;
    struct Vertex { @builtin(position) position:vec4f,@location(0) color:vec3f }
    @vertex fn main(@location(0) point:vec2f,@location(1) normal:vec2f,
      @location(2) translation:vec2f,@location(3) tint:vec3f,@location(4) tag:u32,
      @location(5) shift:vec2i,@builtin(instance_index) instance:u32,@builtin(vertex_index) vertex:u32)->Vertex {
      var out:Vertex;
      out.position=vec4f(point+translation+vec2f(f32(shift.x)*0.05,0),0,1);
      let valid=select(0.0,1.0,tag==11u+instance && shift.y==7 && vertex<4u && vertex>=u32(minimumVertex.x));
      out.color=vec3f(tint.r*normal.x*2*valid,tint.g*normal.y*4*valid,1-valid);
      return out;
    }` : `#version 300 es
    precision highp float;precision highp int;
    layout(location=0) in vec2 point;layout(location=1) in vec2 normal;
    layout(location=2) in vec2 translation;layout(location=3) in vec3 tint;
    layout(location=4) in uint tag;layout(location=5) in ivec2 shift;
    layout(std140) uniform Settings{vec4 _group_0_binding_0_minimum_vertex;};
    out vec3 ink;
    void main(){
      gl_Position=vec4(point+translation+vec2(float(shift.x)*0.05,0),0,1);
      float valid=tag==11u+uint(gl_InstanceID)&&shift.y==7&&gl_VertexID<4&&gl_VertexID>=int(_group_0_binding_0_minimum_vertex.x)?1.0:0.0;
      ink=vec3(tint.r*normal.x*2.0*valid,tint.g*normal.y*4.0*valid,1.0-valid);
    }`;
  const fragment=gpu.backend==='webgpu' ? '@fragment fn main(@location(0) color:vec3f)->@location(0) vec4f{return vec4f(color,1);}'
    : '#version 300 es\nprecision highp float;in vec3 ink;out vec4 color;void main(){color=vec4(ink,1);}';
  const shader=await gpu.shader(surface,{passes:[{vertex,fragment,vertexBuffers:layouts,draws:[],
    uniforms:[{name:'minimum_vertex',group:0,binding:0}],depth:false,blend:'opaque',topology:'triangle-list'}]});
  const vertices=new Float32Array(32),signed=new Int32Array(16);
  vertices.fill(-99);signed.fill(99);
  for(const [index,point] of [[-.2,-.6],[.2,-.6],[.2,.6],[-.2,.6]].entries()) {
    vertices.set([...point,.5,.25],(index+4)*4);signed.set([-2,7],(index+4)*2);
  }
  const instances=new Uint8Array(72),view=new DataView(instances.buffer);
  for(const [index,record] of [[-3,0,0,0,1,99],[-.5,0,1,0,0,11],[.5,0,0,1,0,12]].entries()) {
    for(let component=0;component<5;component++) view.setFloat32(index*24+component*4,record[component],true);
    view.setUint32(index*24+20,record[5],true);
  }
  const verticesForTexture=[];
  for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) verticesForTexture.push(x*128,y*64,x,y,1,1,1,1);
  const context=new OffscreenCanvas(128,64).getContext('2d');
  const frame=(minimum=0)=>{
    const image=shader.render(128,64,[{minimum_vertex:minimum}]);
    gpu.begin(surface,[0,0,0]);
    gpu.triangles(surface,new Float32Array(verticesForTexture),image,{x:0,y:0,width:128,height:64});
    gpu.present(surface,128,64,1);context.drawImage(canvas,0,0);
  };
  const expect=(x,y,red,green,blue)=>{
    const actual=[...context.getImageData(x,y,1,1).data];
    if(actual.slice(0,3).some((channel,index)=>Math.abs(channel-[red,green,blue][index])>4)||actual[3]!==255)
      throw new Error(`Typed shader buffers ${gpu.backend} pixel ${x},${y}: ${actual}; expected ${red},${green},${blue},255`);
  };
  try {
    shader.vertexBuffer(0,0,vertices);shader.vertexBuffer(0,1,instances);shader.vertexBuffer(0,2,signed);
    shader.indexBuffer(0,new Uint32Array([99,99,99,0,1,2,0,2,3,99]));
    shader.draws(0,new Uint32Array([6,2,3,4,1,1]));
    frame();expect(16,32,255,0,0);expect(90,32,0,255,0);expect(60,32,0,0,0);expect(104,32,0,0,0);
    view.setFloat32(24+8,.25,true);view.setFloat32(48+12,.5,true);
    shader.vertexBuffer(0,1,instances);
    frame();expect(16,32,137,0,0);expect(90,32,0,188,0);
    shader.draws(0,new Uint32Array([3,1,1,4,1,0]));
    frame(1);expect(34,32,137,0,0);expect(90,32,0,0,0);
    const grown=new Uint8Array(144);grown.set(instances);shader.vertexBuffer(0,1,grown);
    frame(1);expect(34,32,137,0,0);
    shader.vertexBuffer(0,1,new Uint8Array(24));
    let rejected=false;try{frame(1);}catch(error){rejected=/instance/.test(error.message);}
    if(!rejected) throw new Error('Shrinking a bound stream did not reject an out-of-range draw');
    shader.vertexBuffer(0,1,instances);frame(1);expect(34,32,137,0,0);
    shader.draws(0,new Uint32Array());frame();expect(34,32,0,0,0);
    if(surface.gl&&surface.gl.getError()!==surface.gl.NO_ERROR) throw new Error('Typed shader buffers produced a WebGL API error');
    if(errors.length) throw errors[0];
  } finally { shader.close();gpu.releaseSurface(surface);gpu.close(); }
}
