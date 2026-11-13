import {createShaderStream} from './shader-streams.js';

// WebGPU/Vulkan take flat values from the first vertex. WebGL's default takes
// the last. Cyclically permute each list primitive without changing its winding
// or original vertex IDs when the context cannot select the first convention.
export function createWebGlPrimitiveDraws(topology,transfer) {
  const width={'triangle-list':3,'line-list':2,'point-list':1}[topology];
  if(width===undefined) throw new Error('Unsupported shader list topology');
  const indices=createShaderStream(transfer,'index');
  let source=null,commands=[];
  return {
    get buffer() {return indices.buffer;},
    prepare(geometry) {
      const next=geometry.commands;
      if(next===source) return commands;
      const length=next.reduce((total,command)=>total+Math.floor(command.count/width)*width,0);
      const values=new Uint32Array(length);let cursor=0;
      commands=next.flatMap(command=>{
        const count=Math.floor(command.count/width)*width;
        if(count===0) return [];
        const first=cursor;
        for(let base=0;base<count;base+=width) for(let lane=0;lane<width;lane++) {
          const index=command.first+base+(lane+1)%width;
          values[cursor++]=command.indexed?geometry.indexValues[index]:index;
        }
        return [{...command,count,first,indexed:true}];
      });
      indices.replace(values);source=next;
      return commands;
    },
    close() {indices.close();source=null;commands=[];}
  };
}
