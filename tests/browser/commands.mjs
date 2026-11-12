import assert from 'node:assert/strict';

export async function verifyCommands({click,key,evaluate,command,waitFor,settled,screenshot}) {
  await evaluate(`(() => {
    window.commandKeys=[];
    document.addEventListener('keydown',event=>window.commandKeys.push({
      code:event.code,prevented:event.defaultPrevented
    }));
  })()`);
  await click(70,60);
  await key('End','End',35,2);
  await key('f','KeyF',70,2);
  await waitFor('window.uiTest.drawn().includes("Find 1")');
  assert(await evaluate('window.commandKeys.findLast(event=>event.code==="KeyF").prevented'),
    'A DynLex command did not suppress the native browser command.');
  await key('Enter','Enter',13,2);
  await waitFor('window.uiTest.drawn().includes("Run 1")');
  assert.equal(await evaluate('document.querySelector("textarea").value'),'alpha',
    'A control shortcut also performed the editor default.');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor('document.querySelector("textarea").value==="alpha "');
  assert.equal(await evaluate('window.commandKeys.findLast(event=>event.code==="Space").prevented'),false,
    'Shared text entry suppressed the browser character event.');
  await key('z','KeyZ',90,2);
  await waitFor('document.querySelector("textarea").value==="alpha"');
  // An unbound function key retains its platform default. Synthetic dispatch
  // observes cancellation without opening browser chrome on the test display.
  assert.equal(await evaluate(`(() => {
    const event=new KeyboardEvent('keydown',{code:'F6',key:'F6',bubbles:true,cancelable:true});
    document.querySelector('textarea').dispatchEvent(event);
    return event.defaultPrevented;
  })()`),false);
  await settled();
  await screenshot('commands-shared');
}
