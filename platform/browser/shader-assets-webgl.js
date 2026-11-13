import {shaderImageLevel} from './shader-assets.js';

export function webGlShaderAssetDriver(gl) {
  const formats={rgba8unorm:gl.RGBA8,'rgba8unorm-srgb':gl.SRGB8_ALPHA8,rgba16float:gl.RGBA16F,
    depth24plus:gl.DEPTH_COMPONENT24,depth32float:gl.DEPTH_COMPONENT32F};
  const compare=value=>gl[value.toUpperCase().replaceAll('-','_').replace('LESS_EQUAL','LEQUAL').replace('GREATER_EQUAL','GEQUAL').replace('NOT_EQUAL','NOTEQUAL')];
  const wrap={'repeat':gl.REPEAT,'mirror-repeat':gl.MIRRORED_REPEAT,'clamp-to-edge':gl.CLAMP_TO_EDGE};
  const error=message=>{if(gl.getError()!==gl.NO_ERROR) throw new Error(message);};
  return {
    texture(description,width,height) {
      const cube=description.dimension==='cube',format=formats[description.format];
      if(format===undefined) throw new Error('Unknown shader image format');
      if(Math.max(width,height)>gl.getParameter(cube?gl.MAX_CUBE_MAP_TEXTURE_SIZE:gl.MAX_TEXTURE_SIZE))
        throw new Error('Shader image dimensions exceed device limits');
      if(description.format==='rgba16float'&&!gl.getExtension('EXT_color_buffer_float'))
        throw new Error('Floating-point shader targets require EXT_color_buffer_float');
      if(description.samples>1) {
        if(!gl.getInternalformatParameter(gl.RENDERBUFFER,format,gl.SAMPLES).includes(description.samples))
          throw new Error('The device does not support the requested shader image sample count');
        const renderbuffer=gl.createRenderbuffer();
        if(!renderbuffer) throw new Error('WebGL could not allocate a shader attachment');
        try {
          gl.bindRenderbuffer(gl.RENDERBUFFER,renderbuffer);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER,description.samples,format,width,height);
          error('WebGL could not allocate shader attachment storage');
          return {renderbuffer,handle:null,target:null};
        } catch(failure) {gl.deleteRenderbuffer(renderbuffer);throw failure;}
      }
      const handle=gl.createTexture(),target=cube?gl.TEXTURE_CUBE_MAP:gl.TEXTURE_2D;
      if(!handle) throw new Error('WebGL could not allocate a shader image');
      try {
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(target,handle);
        gl.texStorage2D(target,description.levels,format,width,height);
        gl.texParameteri(target,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(target,gl.TEXTURE_MAX_LEVEL,description.levels-1);
        gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        error('WebGL could not allocate shader image storage');
        return {handle,target,renderbuffer:null};
      } catch(failure) {gl.deleteTexture(handle);throw failure;}
    },
    sampler(description) {
      const sampler=gl.createSampler();
      if(!sampler) throw new Error('WebGL could not allocate a shader sampler');
      try {
        const minification=description.minFilter==='linear'
          ?(description.mipmapFilter==='linear'?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR_MIPMAP_NEAREST)
          :(description.mipmapFilter==='linear'?gl.NEAREST_MIPMAP_LINEAR:gl.NEAREST_MIPMAP_NEAREST);
        gl.samplerParameteri(sampler,gl.TEXTURE_MIN_FILTER,minification);
        gl.samplerParameteri(sampler,gl.TEXTURE_MAG_FILTER,description.magFilter==='linear'?gl.LINEAR:gl.NEAREST);
        for(const [axis,key] of [['S','addressModeU'],['T','addressModeV'],['R','addressModeW']])
          gl.samplerParameteri(sampler,gl['TEXTURE_WRAP_'+axis],wrap[description[key]]);
        gl.samplerParameterf(sampler,gl.TEXTURE_MIN_LOD,description.lodMinClamp);
        gl.samplerParameterf(sampler,gl.TEXTURE_MAX_LOD,description.lodMaxClamp);
        gl.samplerParameteri(sampler,gl.TEXTURE_COMPARE_MODE,description.compare==='none'?gl.NONE:gl.COMPARE_REF_TO_TEXTURE);
        if(description.compare!=='none') gl.samplerParameteri(sampler,gl.TEXTURE_COMPARE_FUNC,compare(description.compare));
        if(description.maxAnisotropy>1) {
          const extension=gl.getExtension('EXT_texture_filter_anisotropic');
          if(extension===null||description.maxAnisotropy>gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
            throw new Error('The device does not support the requested shader sampler anisotropy');
          gl.samplerParameterf(sampler,extension.TEXTURE_MAX_ANISOTROPY_EXT,description.maxAnisotropy);
        }
        error('WebGL could not configure a shader sampler');
        return sampler;
      } catch(failure) {gl.deleteSampler(sampler);throw failure;}
    },
    write(record,level,layer,bytes) {
      const {width,height}=shaderImageLevel(record,level),half=record.description.format==='rgba16float';
      const {handle,target}=record.storage;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(target,handle);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      const aligned=half&&bytes.byteOffset%2!==0?bytes.slice():bytes;
      const pixels=half?new Uint16Array(aligned.buffer,aligned.byteOffset,aligned.byteLength/2):aligned;
      gl.texSubImage2D(target===gl.TEXTURE_CUBE_MAP?gl.TEXTURE_CUBE_MAP_POSITIVE_X+layer:target,
        level,0,0,width,height,gl.RGBA,half?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,pixels);
      error('WebGL could not upload a shader image');
    },
    retireTexture(storage) {gl.deleteTexture(storage.handle);gl.deleteRenderbuffer(storage.renderbuffer);},
    retireSampler(sampler) {gl.deleteSampler(sampler);}
  };
}
