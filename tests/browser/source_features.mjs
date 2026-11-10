// The same source-control tests run through the browser's wasm32 ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

const checkout=path.resolve(process.argv[2]);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-source-features-'));
try {
  for(const name of ['source_queries','source_edits','source_completions','overlays','overlay_capture','viewports','source_tools']) {
    const source=path.resolve('tests/shared',name,'main.dl');
    const expected=await fs.readFile(path.join(path.dirname(source),'expected.txt'),'utf8');
    for(const optimization of ['-O0','-O2']) {
      const output=path.join(directory,'main.wasm');
      execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
      const actual=execFileSync(process.execPath,[path.join(checkout,'scripts/run_program.mjs'),output],{encoding:'utf8',timeout:30000});
      assert.equal(actual,expected,`${name} ${optimization}`);
      console.log('PASS wasm source feature',name,optimization);
    }
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
