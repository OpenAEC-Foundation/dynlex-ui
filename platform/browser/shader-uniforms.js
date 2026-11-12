// Reflection defines GPU layout; DynLex supplies already packed numeric bytes.
export function shaderUniformLayout(type) {
  const scalar={float32:0,sint32:1,uint32:2}[type.scalar];
  const {rows,columns}=type;
  if(scalar===undefined||!Number.isInteger(rows)||!Number.isInteger(columns)||
    rows<1||rows>4||columns<1||columns>4||(rows>1&&(scalar!==0||columns<2)))
    throw new Error('Unsupported shader uniform type');
  return {scalar,rows,columns,bytes:rows*16};
}

export function createShaderUniforms(descriptions,transfer) {
  const records=[],names=new Set(),slots=new Set();
  try {
    for(const description of descriptions) {
      const layout=shaderUniformLayout(description.type),key=`${description.group}:${description.binding}`;
      if(!Number.isInteger(description.group)||description.group<0||description.group>4294967295||
        !Number.isInteger(description.binding)||description.binding<0||description.binding>4294967295)
        throw new Error('Shader uniform bindings must be unsigned 32-bit integers');
      if(typeof description.name!=='string'||description.name.length===0||names.has(description.name)||slots.has(key))
        throw new Error('Shader uniforms require distinct names and bindings');
      names.add(description.name);slots.add(key);
      records.push({...description,...layout,buffer:transfer.allocate(description,layout.bytes),ready:false});
    }
  } catch(error) {
    for(const record of records) if(record.buffer!==null) transfer.retire(record.buffer);
    throw error;
  }
  return {
    bindings:records.filter(record=>record.buffer!==null),
    upload(group,binding,scalar,rows,columns,bytes) {
      const record=records.find(record=>record.group===group&&record.binding===binding);
      if(!record) throw new Error('Unknown shader uniform binding');
      if(scalar!==record.scalar||rows!==record.rows||columns!==record.columns)
        throw new Error(`Shader uniform type differs from reflection: ${record.name}`);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength!==record.bytes)
        throw new Error(`Shader uniform bytes differ from its storage layout: ${record.name}`);
      if(record.buffer!==null) transfer.write(record.buffer,bytes);
      record.ready=true;
    },
    requireReady() {
      for(const record of records) if(record.buffer!==null&&!record.ready)
        throw new Error(`Missing shader value: ${record.name}`);
    },
    close() {for(const record of records) if(record.buffer!==null) transfer.retire(record.buffer);}
  };
}
