import assert from 'node:assert/strict';

export async function verifySearch({click,key,evaluate,command,waitFor,settled,screenshot}) {
  const value=()=>evaluate('document.querySelector("textarea").value');
  const copy=async expected=>{
    await key('a','KeyA',65,2); await key('c','KeyC',67,2);
    await waitFor(`navigator.clipboard.readText().then(text=>text===${JSON.stringify(expected)})`);
  };
  await click(70,100);
  assert.equal(await value(),'row\nRow\nrow');
  await key('Home','Home',36,2);
  await key('f','KeyF',70,2);
  await command('Input.insertText',{text:'row'});
  await waitFor('window.uiTest.drawn().includes("1 of 3")');
  await key('Enter','Enter',13);
  await waitFor('window.uiTest.drawn().includes("2 of 3")');
  assert.equal(await value(),'row','Find navigation left its query field.');
  await key('Enter','Enter',13,8);
  await waitFor('window.uiTest.drawn().includes("1 of 3")');
  await screenshot('search-find');
  await key('h','KeyH',72,2);
  assert.equal(await value(),'','Replace did not activate its independent field.');
  await command('Input.insertText',{text:'glow'});
  await key('Enter','Enter',13,3); // Control+Alt replaces all, using shared modifiers.
  await waitFor('window.uiTest.drawn().includes("No matches")');
  assert.equal(await value(),'glow','Replacement took typing focus away.');
  await key('Escape','Escape',27);
  assert.equal(await value(),'glow\nglow\nglow');
  await key('z','KeyZ',90,2);
  await waitFor('document.querySelector("textarea").value==="row\\nRow\\nrow"');
  await copy('row\nRow\nrow');
  // Closing the first pane restores the layout; the second pane has its own query.
  await click(70,350);
  assert.equal(await value(),'get hay');
  await key('f','KeyF',70,2);
  assert.equal(await value(),'','The embedded editor inherited the other pane’s query.');
  await command('Input.insertText',{text:'hay'});
  await waitFor('window.uiTest.drawn().includes("1 of 1")');
  await key('Escape','Escape',27);
  await copy('get hay');
  await settled();
  await screenshot('search-shared-panes');
}
