// Immediate capabilities, such as storage, finish within the originating event.
// The application chooses its explicitly synchronous providers.
export function createServiceCalls({memory,allocate,services,report}) {
  const encoder=new TextEncoder();
  return (name,payload,address,length)=>{
    const reset=()=>{const view=new DataView(memory.buffer);view.setUint32(address,0,true);view.setInt32(length,0,true);};
    reset();
    try {
      if(!Object.hasOwn(services,name)) throw new Error(`Unknown synchronous platform service: ${name}`);
      const result=services[name](payload);
      if(result!==null&&typeof result?.then==='function') throw new Error('A synchronous platform service returned a promise');
      const json=JSON.stringify(result);
      if(json===undefined) throw new Error('A synchronous platform service did not return JSON');
      const bytes=encoder.encode(json),pointer=allocate(bytes.length+1);
      const output=new Uint8Array(memory.buffer,pointer,bytes.length+1);output.set(bytes);output[bytes.length]=0;
      const view=new DataView(memory.buffer);view.setUint32(address,pointer,true);view.setInt32(length,bytes.length,true);
      return 0;
    } catch(error) {report(name,error);return 1;}
  };
}
