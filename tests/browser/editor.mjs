import assert from 'node:assert/strict';

export async function verifyEditor({ click, key, evaluate, command, waitFor, settled, screenshot }) {
  const value = () => evaluate('document.querySelector("textarea").value');
  const copyAll = async expected => {
    await key('a', 'KeyA', 65, 2); await key('c', 'KeyC', 67, 2);
    await waitFor(`navigator.clipboard.readText().then(text => text === ${JSON.stringify(expected)})`);
  };
  const original = 'alpha selected omega\nnext line';
  const committed = 'alpha 東京 omega\nnext line';
  await click(40, 32); await settled();
  assert.equal(await evaluate('document.activeElement.tagName'), 'CANVAS');
  await click(70, 90); await settled();
  assert.equal(await evaluate('document.activeElement.tagName'), 'TEXTAREA');
  assert.equal(await value(), original);
  await key('Home', 'Home', 36, 2);
  for (let index = 0; index < 6; index++) await key('ArrowRight', 'ArrowRight', 39);
  for (let index = 0; index < 8; index++) await key('ArrowRight', 'ArrowRight', 39, 8);
  assert.deepEqual(await evaluate('({ start:document.activeElement.selectionStart, end:document.activeElement.selectionEnd })'),
    { start: 6, end: 14 });
  const before = await screenshot('editor-before-composition');
  await command('Input.imeSetComposition', { text: 'とうきょう', selectionStart: 5, selectionEnd: 5,
    replacementStart: 6, replacementEnd: 14 });
  await waitFor('window.uiTest.drawn().some(text => text.includes("とうきょう"))');
  assert(await evaluate('window.uiTest.drawn().every(text => !text.includes("selected"))'),
    'Composition overlaid its selected source instead of replacing its presentation');
  assert.notEqual(await screenshot('editor-composing'), before);
  await command('Input.insertText', { text: '東京' }); await settled();
  await copyAll(committed);
  await key('z', 'KeyZ', 90, 2); await settled();
  assert.equal(await value(), original, 'A composition commit was not one undoable edit');
  await key('z', 'KeyZ', 90, 10); await settled();
  assert.equal(await value(), committed);
  await command('Input.imeSetComposition', { text: '未確定', selectionStart: 3, selectionEnd: 3 });
  await waitFor('window.uiTest.drawn().some(text => text.includes("未確定"))');
  await command('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }); await settled();
  assert.equal(await value(), committed, 'Cancelling composition changed the source');
  await key('z', 'KeyZ', 90, 2); await settled();
  assert.equal(await value(), original, 'Tentative composition added an undo entry');
  await key('z', 'KeyZ', 90, 10); await settled();
  await screenshot('editor-committed');
  const proxy = await evaluate(`(() => {
    const input = document.querySelector('textarea'), bounds = input.getBoundingClientRect();
    return { x:bounds.x, y:bounds.y, height:bounds.height, readonly:input.readOnly };
  })()`);
  assert(proxy.x >= 24 && proxy.y >= 60 && proxy.height > 10 && !proxy.readonly,
    `The native input context was not positioned at the canvas caret: ${JSON.stringify(proxy)}`);
  await key('Home', 'Home', 36, 2);
  await key('ArrowRight', 'ArrowRight', 39); await settled();
  // Hold the next scheduled paint so the repeated key and text commit must
  // reconcile their native input context within the input events themselves.
  await evaluate(`(() => {
    window.inputFrameGate = { request:window.requestAnimationFrame, callbacks:[] };
    window.requestAnimationFrame = callback => {
      window.inputFrameGate.callbacks.push(callback);
      return window.inputFrameGate.request(() => {});
    };
  })()`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight',
    windowsVirtualKeyCode:39, autoRepeat:true });
  await command('Input.insertText', { text:'X' });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
  assert.equal(await value(), 'alXpha 東京 omega\nnext line', 'Typing after a repeated key used an outdated native selection');
  await evaluate(`(() => {
    const gate = window.inputFrameGate; window.requestAnimationFrame = gate.request;
    delete window.inputFrameGate; for (const callback of gate.callbacks) callback(performance.now());
  })()`);
  await settled();
  await evaluate(`(() => {
    const outside = document.createElement('input'); outside.id = 'outside';
    Object.assign(outside.style, {position:'fixed',left:'1000px',top:'0'});
    document.body.append(outside); outside.focus();
  })()`);
  await settled();
  assert.equal(await evaluate('document.activeElement.id'), 'outside', 'The canvas took keyboard focus back');
  await click(40, 32); await settled();
  assert.equal(await evaluate('document.activeElement.tagName'), 'CANVAS');
  assert(await evaluate('document.querySelector("textarea").readOnly'), 'A read-only selection kept text input active');
  await evaluate('document.querySelector("#outside").remove()');
}
