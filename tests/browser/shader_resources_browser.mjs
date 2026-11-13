import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const core=path.resolve(process.env.DYNLEX_CORE);
const {navigate,evaluate,closeBrowserSession,consoleErrors,runtimeExceptions}=await import(
  pathToFileURL(path.join(core,'tests/web/browser_test_driver.mjs')));
try {
  await navigate('/tests/browser/shader_resources.html');
  const result=await evaluate(`import('/tests/browser/shader_resource_rendering.mjs').then(module=>module.verifyShaderResources())`);
  assert.deepEqual(result,['webgpu','webgl']);
  assert.deepEqual(consoleErrors,[]);
  assert.deepEqual(runtimeExceptions,[]);
  console.log('Shader resource pixels pass on WebGPU and WebGL: independent samplers, 2D orientation, cube faces/mips, sRGB, HDR and filtered depth comparison.');
} finally {closeBrowserSession();}
