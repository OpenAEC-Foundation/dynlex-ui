// Empty draws still preserve attachment clears, resolves and discards.
export function shaderPassHasWork(description,commands) {
  if(commands.length!==0) return true;
  const {color,depth}=description;
  return (color!==null&&(color.load!=='load'||color.store!=='store'||color.resolve!==null))||
    (depth!==null&&(depth.load!=='load'||depth.store!=='store'));
}
