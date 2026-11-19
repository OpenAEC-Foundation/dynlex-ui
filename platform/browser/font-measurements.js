// Metrics at a given scale are immutable after a face loads. FIFO bounds both entries
// and retained text; cache hits do not churn Map insertion order.
export function createFontMeasurements(context,configure,maximumEntries=4096,maximumCharacters=1024*1024) {
  const entries=new Map();
  let characters=0;
  const remove=key=>{
    characters-=entries.get(key).characters;
    entries.delete(key);
  };
  return {
    measure(handle,font,text,scale=1) {
      const key=`${handle}:${scale}:${text}`,cached=entries.get(key);
      if(cached) return cached.metrics;
      configure(context,font,scale);
      const metrics=context.measureText(text);
      if(text.length>maximumCharacters) return metrics;
      while(entries.size>=maximumEntries||characters+text.length>maximumCharacters)
        remove(entries.keys().next().value);
      entries.set(key,{handle,characters:text.length,metrics});
      characters+=text.length;
      return metrics;
    },
    forget(handle) {
      for(const [key,entry] of entries) if(entry.handle===handle) remove(key);
    }
  };
}
