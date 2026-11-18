// The same source-control tests run through the browser's wasm32 ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const {observeAllocations}=await import(pathToFileURL(path.join(checkout,'tests/web/allocation_probe.mjs')));
const cases=['shared/document_forms','unit/text','shared/disabled_text','unit/composition','integration/ui_controls','integration/ui_ribbon','shared/choice_popovers','unit/queued_focus','shared/document_controls','shared/text_popovers','shared/text_states','shared/event_contexts','shared/overlays','shared/overlay_capture','shared/viewports','unit/input_context','unit/named_content','unit/read_only','shared/services'];
cases.push('integration/snake_input','shared/focus_identity','shared/text_search_model','shared/key_dispatch','shared/text_area','shared/mark_layers','unit/text_marks','shared/control_popups','integration/ui_ribbon_events','unit/disabled_navigation');
const selected=process.argv.slice(3);
cases.push('shared/scene_camera','shared/scene_picking','shared/scene_mesh','shared/scene_solids','shared/scene_transforms','shared/scene_models','shared/scene_baking','shared/scene_rotations','shared/color_space','shared/shader_values','shared/shader_api','shared/shader_programs');
cases.push('shared/scene_buffers','shared/scene_uploads','shared/scene_anchors');
assert(selected.every(name=>cases.includes(name)), 'Unknown shared source fixture');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-source-features-'));
try {
  for(const name of selected.length?selected:cases) {
    const source=path.resolve('tests',name,'main.dl');
    const expected=await fs.readFile(path.join(path.dirname(source),'expected.txt'),'utf8');
    for(const optimization of ['-O0','-O2']) {
      const output=path.join(directory,'main.wasm');
      execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
      const bytes=await fs.readFile(output),chunks=[];
      const runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      const allocation=observeAllocations(runtime,1024*1024);
      const {instance}=await WebAssembly.instantiate(bytes,runtime);
      try { instance.exports.main(); }
      catch (error) { throw new Error(`${name} ${optimization}: ${chunks.join('')}`, {cause:error}); }
      assert.equal(chunks.join(''),expected,`${name} ${optimization}`);
      assert.equal(allocation.live,0,`${name} ${optimization}: retained editor allocations`);
      console.log('PASS wasm source feature',name,optimization);
    }
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
