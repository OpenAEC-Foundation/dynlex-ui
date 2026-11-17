// Debug names are optional WebAssembly metadata; keep them beside the executable.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function separateWasmNames(input) {
  const bytes=new Uint8Array(input);
  if(!WebAssembly.validate(bytes)) throw new WebAssembly.CompileError('Invalid executable Wasm module');
  const parts=[bytes.subarray(0,8)],symbols=[];
  const integer=cursor=>{
    let value=0,shift=0,byte;
    do {byte=bytes[cursor.position++];value+=(byte&127)*2**shift;shift+=7;} while(byte&128);
    return value;
  };
  const cursor={position:8},decoder=new TextDecoder('utf-8',{fatal:true});
  while(cursor.position<bytes.length) {
    const start=cursor.position,id=bytes[cursor.position++],size=integer(cursor),payload=cursor.position,end=payload+size;
    if(end>bytes.length) throw new WebAssembly.CompileError('Invalid WebAssembly section length');
    let debug=false;
    if(id===0) {
      const length=integer(cursor);
      debug=decoder.decode(bytes.subarray(cursor.position,cursor.position+length))==='name';
    }
    (debug?symbols:parts).push(bytes.subarray(start,end));cursor.position=end;
  }
  const join=values=>{const result=new Uint8Array(values.reduce((sum,value)=>sum+value.length,0));let at=0;for(const value of values){result.set(value,at);at+=value.length;}return result;};
  return {module:join(parts),names:join(symbols)};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file=process.argv[2],{module,names}=separateWasmNames(await fs.readFile(file));
  await fs.writeFile(file,module);
  await fs.writeFile(file+'.names',names);
}
