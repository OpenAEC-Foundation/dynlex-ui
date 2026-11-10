// Web Audio resources and controls. Applications own cue names, timing and policy.
export function createAudioServices(base, dependencies={}) {
  const createContext=dependencies.createContext ?? (()=>new AudioContext());
  const fetchAudio=dependencies.fetch ?? globalThis.fetch;
  const buffers=new Map(), voices=new Map();
  let context, sequence=0, closed=false;
  const voice=id=>{
    const record=voices.get(id);
    if(record===undefined) throw new Error(`Unknown audio voice: ${id}`);
    return record;
  };
  function finish(record,error) {
    if(record.ended) return;
    record.ended=true;
    record.source.onended=null;
    record.source.disconnect();record.gain.disconnect();
    if(error===undefined) record.resolve({ended:true});else record.reject(error);
  }
  function stop(record,error) {
    if(!record.ended) {
      if(record.started) record.source.stop();
      finish(record,error);
    }
    if(error!==undefined) {
      record.signal.removeEventListener('abort',record.abort);
      voices.delete(record.id);
    }
  }
  async function audio(payload,{signal}) {
    signal.throwIfAborted();
    if(closed) throw new Error('Audio services are closed');
    if(payload.operation==='load') {
      context ??= createContext();
      const decoded=await Promise.all(payload.urls.map(async path=>{
        const response=await fetchAudio(new URL(path,base),{signal});
        if(!response.ok) throw new Error(`Audio resource: HTTP ${response.status}`);
        return context.decodeAudioData(await response.arrayBuffer());
      }));
      signal.throwIfAborted();
      if(closed) throw new Error('Audio services closed during decoding');
      return {buffers:decoded.map(buffer=>{
        const id=++sequence;buffers.set(id,buffer);return {id,duration:buffer.duration};
      })};
    }
    if(payload.operation==='play') {
      if(voices.has(payload.voice)) throw new Error(`Audio voice already exists: ${payload.voice}`);
      const buffer=buffers.get(payload.buffer);
      if(buffer===undefined) throw new Error(`Unknown audio buffer: ${payload.buffer}`);
      const source=context.createBufferSource(),gain=context.createGain();
      source.buffer=buffer;source.loop=payload.loop;source.playbackRate.value=payload.rate;
      gain.gain.value=payload.volume;source.connect(gain);gain.connect(context.destination);
      return new Promise((resolve,reject)=>{
        const record={id:payload.voice,source,gain,signal,resolve,reject,started:false,ended:false,abort:null};
        record.abort=()=>stop(record,signal.reason);
        voices.set(payload.voice,record);
        signal.addEventListener('abort',record.abort,{once:true});
        source.onended=()=>finish(record);
        try {
          source.start(0,payload.offset);record.started=true;
          context.resume().catch(error=>stop(record,error));
        } catch(error) { stop(record,error); }
      });
    }
    if(payload.operation==='unload') {
      for(const id of payload.buffers) {
        const buffer=buffers.get(id);
        if(buffer===undefined) throw new Error(`Unknown audio buffer: ${id}`);
        if([...voices.values()].some(record=>!record.ended && record.source.buffer===buffer))
          throw new Error('Cannot unload a playing audio buffer');
        buffers.delete(id);
      }
      return null;
    }
    if(payload.operation==='state') {
      const record=voice(payload.voice);
      if(!record.ended) {
        const now=context.currentTime;
        record.source.playbackRate.setValueAtTime(payload.rate,now);
        const gain=record.gain.gain;
        gain.cancelScheduledValues(now);gain.setValueAtTime(gain.value,now);
        gain.linearRampToValueAtTime(payload.volume,now+payload.fade);
      }
      return {ended:record.ended};
    }
    if(payload.operation==='release') {
      const record=voice(payload.voice);stop(record);
      record.signal.removeEventListener('abort',record.abort);
      voices.delete(payload.voice);return null;
    }
    throw new Error(`Unknown audio operation: ${payload.operation}`);
  }
  return {services:{audio},async close() {
    if(closed) return;
    closed=true;
    for(const record of voices.values()) {
      stop(record);record.signal.removeEventListener('abort',record.abort);
    }
    voices.clear();buffers.clear();
    if(context!==undefined) await context.close();
  }};
}
