import { buildRuntimeImports, createRuntimeFilesystem, inspectRuntimeWasmLayout } from "./runtime/runtimeImports.js";
import { createUiHost } from "./host.js";

export let application;

const root = document.querySelector("main");
try {
  const base = new URL("../", import.meta.url);
  const manifest = await fetch(new URL("application.json", base)).then(response => {
    if (!response.ok) throw new Error(`Application manifest: HTTP ${response.status}`);
    return response.json();
  });
  const bytes = await fetch(new URL(manifest.module, base)).then(response => {
    if (!response.ok) throw new Error(`Application module: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  const output = { push(chunk) { console.log("DynLex:", chunk); } };
  const runtime = buildRuntimeImports(output, createRuntimeFilesystem(), inspectRuntimeWasmLayout(bytes));
  const host = await createUiHost(root, manifest.fonts, base, runtime);
  Object.assign(runtime.env, host.imports);
  const { instance } = await WebAssembly.instantiate(bytes, runtime);
  host.attach(instance);
  application = host;
  instance.exports.main();
  window.addEventListener("pagehide", () => host.close(), { once: true });
} catch (error) {
  console.error("DynLex UI startup:", error);
  root.textContent = "An error occurred. Check the log.";
}
