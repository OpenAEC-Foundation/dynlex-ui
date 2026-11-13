// Own GPU objects described by DynLex; the backend implements their API details.
export function shaderImageLevel(record,level) {
  return {width:Math.max(1,Math.floor(record.width/(2**level))),height:Math.max(1,Math.floor(record.height/(2**level)))};
}
export function createShaderAssets(descriptions,driver) {
  const records=new Map();let closed=false,generation=0;
  const active=()=>{if(closed) throw new Error('The shader asset bank is closed');};
  const retire=record=>{
    if(record.storage!==null) {
      if(record.description.kind==='texture') driver.retireTexture(record.storage);
      else driver.retireSampler(record.storage);
    }
  };
  // Check the namespace before acquiring any platform resources.
  for(const description of descriptions) {
    if(typeof description.name!=='string'||description.name.length===0) throw new Error('Shader assets require names');
    if(records.has(description.name)) throw new Error(`Duplicate shader asset: ${description.name}`);
    if(description.kind!=='texture'&&description.kind!=='sampler') throw new Error('Unknown shader asset kind');
    if(description.kind==='texture'&&description.size.kind!=='fixed'&&description.size.kind!=='frame')
      throw new Error('Unknown shader image sizing mode');
    const owned=structuredClone(description);
    if(owned.kind==='texture') Object.freeze(owned.size);
    records.set(description.name,{description:Object.freeze(owned),storage:null,width:0,height:0});
  }
  try {
    for(const record of records.values()) {
      const description=record.description;
      if(description.kind==='sampler') record.storage=driver.sampler(description);
      else if(description.size.kind==='fixed') {
        const {width,height}=description.size;
        record.storage=driver.texture(description,width,height);record.width=width;record.height=height;
      }
    }
  } catch(error) {
    for(const record of records.values()) retire(record);
    throw error;
  }
  const definition=name=>{
    active();
    const record=records.get(name);
    if(record===undefined) throw new Error(`Unknown shader asset: ${name}`);
    return record;
  };
  const find=(name,kind)=>{
    const record=definition(name);
    if(record.description.kind!==kind) throw new Error(`Shader asset ${name} is not a ${kind}`);
    if(record.storage===null) throw new Error(`Shader image ${name} has no physical storage before its first frame`);
    return record;
  };
  return {
    get generation() {active();return generation;},
    definition(name) {return definition(name).description;},
    image(name) {return find(name,'texture');},
    sampler(name) {return find(name,'sampler');},
    resize(width,height) {
      active();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)
        throw new Error('Shader frame dimensions must be positive integers');
      const replacements=[];
      try {
        for(const record of records.values()) {
          if(record.description.kind!=='texture'||record.description.size.kind!=='frame'||
            (record.width===width&&record.height===height)) continue;
          replacements.push({record,storage:driver.texture(record.description,width,height)});
        }
      } catch(error) {
        for(const replacement of replacements) driver.retireTexture(replacement.storage);
        throw error;
      }
      for(const {record,storage} of replacements) {
        retire(record);record.storage=storage;record.width=width;record.height=height;
      }
      if(replacements.length>0) generation++;
    },
    upload(name,level,layer,bytes) {
      const record=find(name,'texture');
      if(!Number.isInteger(level)||level<0||level>=record.description.levels) throw new Error('Invalid shader image level');
      if(!Number.isInteger(layer)||layer<0||layer>=record.description.layers) throw new Error('Invalid shader image layer');
      if(record.description.samples!==1) throw new Error('Multisample shader images cannot be uploaded');
      if(!(bytes instanceof Uint8Array)) throw new Error('Shader image uploads require raw bytes');
      const stride={'rgba8unorm':4,'rgba8unorm-srgb':4,'rgba16float':8}[record.description.format];
      if(stride===undefined) throw new Error('Depth shader images are written by render passes');
      const {width,height}=shaderImageLevel(record,level);
      if(bytes.byteLength!==width*height*stride) throw new Error('Shader image upload does not match its level extent and format');
      driver.write(record,level,layer,bytes);
    },
    close() {active();closed=true;for(const record of records.values()) retire(record);records.clear();}
  };
}
