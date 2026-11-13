// Canonical test descriptions, independent of renderer allocation decisions.
export const shaderView=(image,level=0,layer=0)=>({image,level,layer});
export const shaderColor=(image='output',load='clear',clear=[0,0,0,1],resolve=null,store='store')=>({view:shaderView(image),resolve,load,store,clear});
export const shaderDepth=(image='depth',load='clear',clear=1,store='store')=>({view:shaderView(image),load,store,clear});
export const shaderImage=(name,format='rgba8unorm-srgb',samples=1,size={kind:'frame'})=>({kind:'texture',name,format,dimension:'2d',layers:1,levels:1,samples,size});
export const shaderState=(depthWrite=false,depthCompare='always',blend=null,cullMode='none',frontFace='ccw')=>({depthWrite,depthCompare,blend,cullMode,frontFace});
export const additiveBlend={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
export function shaderPass({vertex=null,fragment=null,vertexBuffers=[],indices=null,draws=[],uniforms=[],resources=[],glslBindings=[],glslUniforms=[],
  pipelines=[shaderState()],color=shaderColor(),depth=null,topology='triangle-list'}) {
  return {vertex,fragment,vertexBuffers,indices,draws,uniforms,resources,glslBindings,glslUniforms,pipelines,color,depth,topology};
}
export const shaderProgram=(passes,assets=[])=>({operation:'shader',output:'output',assets:[shaderImage('output'),...assets],passes});
