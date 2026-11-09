import { loadUiApplication } from './application.js';

export let application;

const root = document.querySelector("main");
try {
  application = await loadUiApplication(root, new URL('../application.json', import.meta.url));
  window.addEventListener('pagehide', () => application.close(), { once: true });
} catch (error) {
  console.error("DynLex UI startup:", error);
  root.textContent = "An error occurred. Check the log.";
}
