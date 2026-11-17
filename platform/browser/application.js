import { buildRuntimeImports, createRuntimeFilesystem, inspectRuntimeWasmLayout } from './runtime/runtimeImports.js';
import { createUiHost } from './host.js';

export async function loadUiApplication(root, manifestUrl, options = {}) {
  const read = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Application resource: HTTP ${response.status}`);
    return response;
  };
  const manifest = await (await read(manifestUrl)).json();
  const base = new URL('./', manifestUrl);
  const response = read(new URL(manifest.module, base));
  const compiled = response.then(resource => WebAssembly.compileStreaming(resource.clone()));
  const output = options.output ?? { push(chunk) { console.log('DynLex:', chunk); } };
  const loadingRuntime = response.then(resource => resource.arrayBuffer()).then(bytes =>
    buildRuntimeImports(output, createRuntimeFilesystem(), inspectRuntimeWasmLayout(bytes)));
  const [host, module, runtime] = await Promise.all([
    createUiHost(root, manifest.fonts, base, loadingRuntime, options), compiled, loadingRuntime
  ]);
  Object.assign(runtime.env, host.imports);
  const instance = await WebAssembly.instantiate(module, runtime);
  host.attach(instance);
  instance.exports.main();
  return host;
}
