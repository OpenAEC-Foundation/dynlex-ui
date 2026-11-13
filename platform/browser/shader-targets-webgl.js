import {shaderImageLevel} from './shader-assets.js';

// Physical views and render-pass attachment operations. DynLex links the graph.
export function createWebGlShaderTargets(gl,assets,color,depth) {
  const framebuffer=gl.createFramebuffer(),resolve=color!==null&&color.resolve!==null?gl.createFramebuffer():null;
  let generation=-1,width=0,height=0;
  if(framebuffer===null||(color!==null&&color.resolve!==null&&resolve===null)) {
    gl.deleteFramebuffer(framebuffer);gl.deleteFramebuffer(resolve);throw new Error('WebGL could not allocate shader pass framebuffers');
  }
  const attach=(slot,view)=>{
    const record=assets.image(view.image),storage=record.storage;
    if(storage.renderbuffer!==null) gl.framebufferRenderbuffer(gl.FRAMEBUFFER,slot,gl.RENDERBUFFER,storage.renderbuffer);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER,slot,storage.target===gl.TEXTURE_CUBE_MAP?gl.TEXTURE_CUBE_MAP_POSITIVE_X+view.layer:gl.TEXTURE_2D,storage.handle,view.level);
    return shaderImageLevel(record,view.level);
  };
  const complete=()=>{
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('WebGL shader pass framebuffer is incomplete');
  };
  return {
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      if(generation!==assets.generation) {
        let extent;
        if(color!==null) extent=attach(gl.COLOR_ATTACHMENT0,color.view);
        if(depth!==null) extent=attach(gl.DEPTH_ATTACHMENT,depth.view);
        if(extent===undefined) throw new Error('A shader pass requires an attachment');
        ({width,height}=extent);
        gl.drawBuffers([color===null?gl.NONE:gl.COLOR_ATTACHMENT0]);gl.readBuffer(color===null?gl.NONE:gl.COLOR_ATTACHMENT0);complete();
        if(resolve!==null) {
          gl.bindFramebuffer(gl.FRAMEBUFFER,resolve);attach(gl.COLOR_ATTACHMENT0,color.resolve);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);complete();
          gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        }
        generation=assets.generation;
      }
      gl.viewport(0,0,width,height);gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);
      let mask=0;
      if(color!==null&&color.load==='clear') {gl.clearColor(...color.clear);mask|=gl.COLOR_BUFFER_BIT;}
      if(depth!==null&&depth.load==='clear') {gl.clearDepth(depth.clear);mask|=gl.DEPTH_BUFFER_BIT;}
      if(mask!==0) gl.clear(mask);
    },
    end() {
      if(resolve!==null) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,resolve);
        gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      }
      const discarded=[];
      if(color!==null&&color.store==='discard') discarded.push(gl.COLOR_ATTACHMENT0);
      if(depth!==null&&depth.store==='discard') discarded.push(gl.DEPTH_ATTACHMENT);
      if(discarded.length!==0) gl.invalidateFramebuffer(gl.FRAMEBUFFER,discarded);
    },
    close() {gl.deleteFramebuffer(framebuffer);gl.deleteFramebuffer(resolve);}
  };
}
