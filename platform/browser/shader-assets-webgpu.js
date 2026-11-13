import {shaderImageLevel} from './shader-assets.js';

export function webGpuShaderAssetDriver(device,retire) {
  return {
    texture(description,width,height) {
      if(Math.max(width,height)>device.limits.maxTextureDimension2D)
        throw new Error('Shader image dimensions exceed device limits');
      const depth=description.format.startsWith('depth');
      return device.createTexture({label:description.name,size:[width,height,description.layers],
        format:description.format,mipLevelCount:description.levels,sampleCount:description.samples,
        usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|
          (!depth&&description.samples===1?GPUTextureUsage.COPY_DST:0)});
    },
    sampler(description) {
      const {minFilter,magFilter,mipmapFilter,addressModeU,addressModeV,addressModeW,lodMinClamp,lodMaxClamp,maxAnisotropy,compare}=description;
      return device.createSampler({label:description.name,minFilter,magFilter,mipmapFilter,addressModeU,addressModeV,addressModeW,
        lodMinClamp,lodMaxClamp,maxAnisotropy,...(compare==='none'?{}:{compare})});
    },
    write(record,level,layer,bytes) {
      const {width,height}=shaderImageLevel(record,level),stride=record.description.format==='rgba16float'?8:4;
      device.queue.writeTexture({texture:record.storage,mipLevel:level,origin:[0,0,layer]},bytes,
        {bytesPerRow:width*stride,rowsPerImage:height},[width,height,1]);
    },
    retireTexture:retire,
    // WebGPU samplers have no explicit destruction operation.
    retireSampler() {}
  };
}
