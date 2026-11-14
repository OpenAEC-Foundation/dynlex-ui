import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const checkout=path.resolve(process.argv[2]);
const validOnly=process.argv.includes('--valid-only');
const scenarios=process.argv.includes('--font-only')?[1]:[0,1];
const {buildRuntimeImports,createRuntimeFilesystem,inspectRuntimeWasmLayout}=await import(
  pathToFileURL(path.join(checkout,'src/web/ide/public/compiler/runtimeImports.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dynlex-ui-driver-widths-'));
const template=`import ${path.resolve('testing/driver.dl')}
window example:
    button "Action"
set instance to an instance of example
set driver to (@intrinsic("call", "host", "opaque driver", a pointer, (the test UI driver) as a pointer)) as a pointer to UI driver
set chosen to @intrinsic("call", "host", "scenario", an integer)
set width to (@intrinsic("call", "host", "argument", a 64 bit integer, 0)) as a TESTWIDTH bit TESTSIGNinteger
set height to (@intrinsic("call", "host", "argument", a 64 bit integer, 1)) as a TESTWIDTH bit TESTSIGNinteger
set size to (@intrinsic("call", "host", "argument", a 64 bit integer, 2)) as a TESTWIDTH bit TESTSIGNinteger
set view to a new UI view
if chosen = 0:
    set view to a UI view of (the address of instance) sized width by height using font "regular" with driver
else:
    set view to a UI view of (the address of instance) sized (width as a 32 bit integer) by (height as a 32 bit integer) using font "regular" with driver
require condition ((view's width = 640) and (view's height = 480)) reporting "The view dimensions changed."
set font to a new UI font
if chosen = 0:
    set font to a UI font from "regular" sized (size as a 32 bit integer) in (the address of view)
else:
    set font to a UI font from "regular" sized size in (the address of view)
require condition (font's size = 18) reporting "The font size changed."
release UI font (the address of font)
close the address of view
close the address of instance
print line "Driver integer widths retained."
`;
try {
  for(const [bits,sign] of [[32,''],[64,''],[128,''],[64,'unsigned ']]) for(const optimization of ['-O0','-O2']) {
    const source=path.join(directory,'main.dl'),output=path.join(directory,'main.wasm');
    await fs.writeFile(source,template.replaceAll('TESTWIDTH',String(bits)).replaceAll('TESTSIGN',sign));
    execFileSync(path.join(checkout,'build/dynlex'),[source,'--emit-wasm',optimization,'-o',output],{timeout:60000});
    const bytes=await fs.readFile(output),module=await WebAssembly.compile(bytes);
    const run=async(scenario,values)=>{
      const chunks=[],runtime=buildRuntimeImports(chunks,createRuntimeFilesystem(),inspectRuntimeWasmLayout(bytes));
      Object.assign(runtime.env,{'opaque driver':value=>value,scenario:()=>scenario,argument:index=>values[index]});
      const instance=await WebAssembly.instantiate(module,runtime);
      let error;try{instance.exports.main();}catch(failure){error=failure;}
      return {error,output:chunks.join('')};
    };
    for(const scenario of scenarios) {
      const result=await run(scenario,[640n,480n,18n]);
      assert.equal(result.error,undefined,`Valid ${bits}-bit ${scenario===0?'view dimensions':'font size'} failed (${optimization}).`);
      assert.equal(result.output,'Driver integer widths retained.\n');
    }
    // Check wide overflow before any narrowing. A zero is an operation integer,
    // but is not a valid view dimension or font size.
    for(const field of validOnly?[]:[0,1,2]) for(const value of bits===32?[-1n,0n]:[-1n,0n,2147483648n,4294967299n]) {
      const values=[640n,480n,18n];values[field]=value;
      const result=await run(field===2?1:0,values);
      assert(result.error,`Driver field ${field} accepted ${value} at width ${bits}.`);
      assert.match(result.output,value===0n?(field===2?/Font sizes must be positive/:/UI view dimensions must be positive/):/UI operation integers must be between/);
    }
    console.log('PASS driver integer widths',bits,sign.trim()||'signed',optimization);
  }
} finally {await fs.rm(directory,{recursive:true,force:true});}
