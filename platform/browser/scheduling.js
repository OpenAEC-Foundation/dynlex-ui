// Input and service replies still reach DynLex when the browser pauses rAF.
export function createUiScheduling({hidden=()=>document.hidden,
  frame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,enqueue=queueMicrotask,error}) {
  function run(surface) {
    if(surface.closed) return;
    try {
      const continuing=surface.tick(surface.view);
      if(continuing && !surface.closed && !hidden()) schedule(surface);
    } catch(failure) { error(failure); }
  }
  function schedule(surface) {
    if(surface.closed || !surface.tick) return;
    if(hidden()) {
      if(surface.raf!==null) { cancelFrame(surface.raf);surface.raf=null; }
      if(surface.background!==null) return;
      const pending={};surface.background=pending;
      enqueue(()=>{
        if(surface.background!==pending) return;
        surface.background=null;run(surface);
      });
      return;
    }
    if(surface.raf!==null || surface.background!==null) return;
    surface.raf=frame(()=>{surface.raf=null;run(surface);});
  }
  function cancel(surface) {
    if(surface.raf!==null) cancelFrame(surface.raf);
    surface.raf=null;surface.background=null;
  }
  return {schedule,cancel};
}
