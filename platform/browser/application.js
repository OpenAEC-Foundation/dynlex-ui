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
  const bytes = await (await read(new URL(manifest.module, base))).arrayBuffer();
  const output = options.output ?? { push(chunk) { console.log('DynLex:', chunk); } };
  const runtime = buildRuntimeImports(output, createRuntimeFilesystem(), inspectRuntimeWasmLayout(bytes));
  const host = await createUiHost(root, manifest.fonts, base, runtime, options);
  Object.assign(runtime.env, host.imports);
  const { instance } = await WebAssembly.instantiate(bytes, runtime);
  host.attach(instance);
  instance.exports.main();
  return host;
}
