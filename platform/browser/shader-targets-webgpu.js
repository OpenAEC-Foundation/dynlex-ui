// Cache physical subresource views until their frame storage changes.
export function createWebGpuShaderTargets(assets,color,depth) {
  let generation=-1,colorView=null,resolveView=null,depthView=null;
  const view=description=>assets.image(description.image).storage.createView({dimension:'2d',
    baseMipLevel:description.level,mipLevelCount:1,baseArrayLayer:description.layer,arrayLayerCount:1});
  return {
    description() {
      if(generation!==assets.generation) {
        if(color!==null) {colorView=view(color.view);resolveView=color.resolve===null?null:view(color.resolve);}
        if(depth!==null) depthView=view(depth.view);
        generation=assets.generation;
      }
      return {colorAttachments:color===null?[]:[{view:colorView,
        ...(resolveView===null?{}:{resolveTarget:resolveView}),loadOp:color.load,storeOp:color.store,clearValue:color.clear}],
        ...(depth===null?{}:{depthStencilAttachment:{view:depthView,depthClearValue:depth.clear,depthLoadOp:depth.load,depthStoreOp:depth.store}})};
    }
  };
}
