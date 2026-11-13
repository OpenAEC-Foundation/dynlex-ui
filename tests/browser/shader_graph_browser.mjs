import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const core=path.resolve(process.env.DYNLEX_CORE);
const {navigate,evaluate,closeBrowserSession,consoleErrors,runtimeExceptions}=await import(
  pathToFileURL(path.join(core,'tests/web/browser_test_driver.mjs')));
try {
  await navigate('/');
  const result=await evaluate(`import('/__tests__/shader_graph_rendering.mjs').then(module=>module.verifyShaderGraph())`);
  assert.deepEqual(result,['webgpu','webgl']);
  assert.deepEqual(consoleErrors,[]);assert.deepEqual(runtimeExceptions,[]);
  console.log('Public shader graph pixels pass on WebGPU/WebGL: depth-only shadows, HDR/MSAA resolve, postprocessing, culling, sampler aliases, resize and UI composition.');
} finally {closeBrowserSession();}
