// Portable vertex records and draw ranges. Offsets rebind records rather than
// changing shader builtin IDs, which stay local to a draw on every backend.
const formats = new Map();
for (const [scalar, storage] of [['float','FLOAT'],['sint','INT'],['uint','UNSIGNED_INT']]) {
  for (let components=1; components<=4; components++) {
    formats.set(`${scalar}32${components===1?'':`x${components}`}`, Object.freeze({
      components, storage, integer: scalar!=='float', bytes:components*4
    }));
  }
}
const unsigned = (value, name) => {
  if (!Number.isInteger(value) || value<0 || value>0xffffffff) throw new Error(`Invalid shader ${name}`);
  return value;
};

export function shaderVertexLayouts(descriptions) {
  const locations=new Set();
  return descriptions.map(description => {
    const stride=unsigned(description.arrayStride,'vertex stride');
    if (stride===0 || stride%4!==0) throw new Error('Shader vertex stride must be a positive multiple of four');
    if (description.stepMode!=='vertex' && description.stepMode!=='instance') throw new Error('Unknown shader vertex step mode');
    if (description.attributes.length===0) throw new Error('A shader vertex stream must declare attributes');
    let extent=0;
    const attributes=description.attributes.map(attribute => {
      const format=formats.get(attribute.format);
      if (!format) throw new Error(`Unsupported shader vertex format: ${attribute.format}`);
      const shaderLocation=unsigned(attribute.shaderLocation,'attribute location');
      const offset=unsigned(attribute.offset,'attribute offset');
      if (locations.has(shaderLocation)) throw new Error('A shader attribute location is used more than once');
      if (offset%4!==0 || offset+format.bytes>stride) throw new Error('Shader attribute exceeds its vertex stride');
      locations.add(shaderLocation);
      extent=Math.max(extent,offset+format.bytes);
      return { shaderLocation,offset,format:attribute.format,...format };
    });
    return { arrayStride:stride,stepMode:description.stepMode,attributes,extent };
  });
}

export function shaderBufferRecords(layout, bytes) {
  return bytes<layout.extent ? 0 : Math.floor((bytes-layout.extent)/layout.arrayStride)+1;
}

// Both adapters reuse allocations and upload only the supplied logical bytes.
export function createShaderStream(transfer, usage) {
  let buffer=null, capacity=0, byteLength=0, closed=false;
  return {
    get buffer() { return buffer; },
    get byteLength() { return byteLength; },
    replace(data) {
      if (closed) throw new Error('The shader stream is closed');
      if (!ArrayBuffer.isView(data) || data.byteLength%4!==0) throw new Error('Shader stream uploads require four-byte alignment');
      const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
      if (bytes.byteLength>capacity) {
        const size=2**Math.ceil(Math.log2(bytes.byteLength));
        const next=transfer.allocate(size,usage);
        try { transfer.write(next,bytes,usage); }
        catch (error) { transfer.retire(next); throw error; }
        if (buffer!==null) transfer.retire(buffer);
        buffer=next; capacity=size;
      } else if (bytes.byteLength!==0) transfer.write(buffer,bytes,usage);
      byteLength=bytes.byteLength;
    },
    close() {
      if (closed) throw new Error('The shader stream is already closed');
      closed=true;
      if (buffer!==null) transfer.retire(buffer);
      buffer=null; capacity=0; byteLength=0;
    }
  };
}

export function packShaderDraws(draws) {
  const words=new Uint32Array(draws.length*6);
  for (const [index,draw] of draws.entries()) {
    if (typeof draw.indexed!=='boolean') throw new Error('A shader draw must specify whether it is indexed');
    words.set([unsigned(draw.count,'draw count'),unsigned(draw.instances,'draw instances'),
      unsigned(draw.first,'draw first'),unsigned(draw.vertexOffset,'draw vertex offset'),
      unsigned(draw.instanceOffset,'draw instance offset'),draw.indexed?1:0],index*6);
  }
  return words;
}

export function validateShaderDraws(layouts, byteLengths, indices, words) {
  if (!(words instanceof Uint32Array) || words.length%6!==0) throw new Error('Shader draws require six unsigned words each');
  if (byteLengths.length!==layouts.length) throw new Error('Shader buffer lengths do not match the pipeline');
  const commands=[];
  for (let cursor=0; cursor<words.length; cursor+=6) {
    const [count,instances,first,vertexOffset,instanceOffset,indexed]=words.subarray(cursor,cursor+6);
    if (indexed>1) throw new Error('A shader draw has an invalid index flag');
    if (count===0 || instances===0) continue;
    if (count>0x7fffffff || instances>0x7fffffff || first>0x7fffffff)
      throw new Error('Shader draw exceeds portable signed-32-bit limits');
    let last=first+count-1;
    if (indexed) {
      if (indices===null || first+count>indices.length) throw new Error('Shader draw exceeds its index buffer');
      last=0;
      for (let index=first; index<first+count; index++) {
        if (indices[index]===0xffffffff) throw new Error('Primitive restart is not supported by shader list topologies');
        last=Math.max(last,indices[index]);
      }
    }
    const offsets=layouts.map((layout,slot) => {
      const instance=layout.stepMode==='instance';
      const offset=instance?instanceOffset:vertexOffset;
      const final=offset+(instance?instances-1:last);
      if (final>=shaderBufferRecords(layout,byteLengths[slot]))
        throw new Error(`Shader draw exceeds its ${instance?'instance':'vertex'} buffer at slot ${slot}`);
      const bytes=offset*layout.arrayStride;
      if (!Number.isSafeInteger(bytes)) throw new Error('Shader buffer offset exceeds integer precision');
      return bytes;
    });
    commands.push({ count,instances,first,indexed:indexed===1,offsets });
  }
  return commands;
}

export function createShaderGeometry(description, transfer) {
  const layouts=shaderVertexLayouts(description.vertexBuffers);
  const streams=layouts.map(()=>createShaderStream(transfer,'vertex'));
  const indices=createShaderStream(transfer,'index');
  let indexData=null, words=packShaderDraws(description.draws), commands=[], dirty=true, closed=false;
  const active=()=>{ if (closed) throw new Error('The shader geometry is closed'); };
  const stream=slot=>{
    if (!Number.isInteger(slot) || slot<0 || slot>=streams.length) throw new Error('Unknown shader vertex buffer slot');
    return streams[slot];
  };
  return {
    layouts, streams, indices,
    vertexBuffer(slot,data) {
      active();
      const target=stream(slot), previous=target.byteLength;
      target.replace(data);
      if (previous!==target.byteLength) dirty=true;
    },
    indexBuffer(data) {
      active();
      if (!(data instanceof Uint32Array)) throw new Error('Shader indices require unsigned-32-bit records');
      indices.replace(data);
      indexData=data.slice(); dirty=true;
    },
    draws(data) {
      active();
      if (!(data instanceof Uint32Array) || data.length%6!==0) throw new Error('Shader draws require six unsigned words each');
      words=data.slice(); dirty=true;
    },
    bufferBytes(slot) { active(); return stream(slot).byteLength; },
    bufferRecords(slot) { active(); return shaderBufferRecords(layouts[slot],stream(slot).byteLength); },
    get indexCount() { active(); return indices.byteLength/4; },
    get indexValues() { active(); return indexData; },
    get commands() {
      active();
      if (dirty) {
        commands=validateShaderDraws(layouts,streams.map(buffer=>buffer.byteLength),indexData,words);
        dirty=false;
      }
      return commands;
    },
    close() {
      active(); closed=true;
      for (const stream of streams) stream.close();
      indices.close(); indexData=null; words=new Uint32Array(); commands=[];
    }
  };
}
