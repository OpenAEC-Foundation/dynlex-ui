import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { setTimeout as pause } from 'node:timers/promises';
import { readPng } from './png.mjs';
import { prepareScene } from './prepare_scene.mjs';

const directory = path.resolve(process.argv[2] || 'dist/ribbon');
const example = path.basename(directory);
const graphicsMode = process.argv[3] || 'system';
assert(['system', 'webgpu', 'webgl-no-adapter', 'webgl-no-api'].includes(graphicsMode));
assert(process.argv[4], 'Pass the compiler checkout after the graphics mode');
const compiler=path.resolve(process.argv[4]);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dynlex-ui-chrome-'));
try {
  execFileSync(process.execPath,[path.join(compiler,'tests/web/shader_uniforms.mjs'),path.join(compiler,'src/web/ide/public/compiler'),path.join(profile,'shader-uniforms.json')],{timeout:60000});
  await prepareScene(compiler,profile);
} catch(error) {await fs.rm(profile,{recursive:true,force:true});throw error;}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/__tests__/rendering.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await fs.readFile(new URL('./rendering.mjs', import.meta.url)));
      return;
    }
    if(request.url === '/__tests__/shader-uniforms.json') {
      response.setHeader('Content-Type','application/json');
      response.end(await fs.readFile(path.join(profile,'shader-uniforms.json')));return;
    }
    if(request.url === '/__tests__/scene-buffers.json') {
      response.setHeader('Content-Type','application/json');
      response.end(await fs.readFile(path.join(profile,'scene-buffers.json')));return;
    }
    if(request.url === '/__tests__/scene-rendering.mjs') {
      response.setHeader('Content-Type','text/javascript');
      response.end(await fs.readFile(new URL('./scene_rendering.mjs',import.meta.url)));return;
    }
    if(request.url === '/__tests__/shader_fixtures.mjs') {
      response.setHeader('Content-Type','text/javascript');
      response.end(await fs.readFile(new URL('./shader_fixtures.mjs',import.meta.url)));return;
    }
    const filename = path.resolve(directory, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!filename.startsWith(directory + '/') && filename !== directory) throw new Error('Path');
    const resolved = filename === directory ? path.join(filename, 'index.html') : filename;
    response.setHeader('Content-Type', mime[path.extname(resolved)] || 'application/octet-stream');
    response.end(await fs.readFile(resolved));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  ...(process.env.DYNLEX_BACKGROUND_BROWSER ? ['--ozone-platform=x11'] : ['--headless=new']),
  ...(graphicsMode === 'webgpu' ? ['--enable-gpu', '--enable-unsafe-webgpu',
    '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'] : []),
  ...(graphicsMode.startsWith('webgl-') ? ['--use-gl=angle', '--use-angle=swiftshader'] : []),
  '--mute-audio', '--no-first-run', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '' } });
let stderr = ''; chrome.stderr.on('data', data => { stderr += data; });
let socket;
try {
  let port;
  for (let count = 0; count < 150; count++) {
    try { port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await pause(100); }
  }
  assert(port, `Chrome did not start: ${stderr}`);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const operation = pending.get(message.id); pending.delete(message.id);
      if (message.error) operation.reject(new Error(message.error.message)); else operation.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.description || arg.value));
    }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let count = 0; count < 300; count++) {
      assert.equal(errors.length, 0, JSON.stringify(errors));
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}\n${stderr}`);
  };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    // Test-side instrumentation: the application has no paint counters or test API.
    const frames = new Set();
    let drawn = [], textBounds = []; const images = new Set(), masks = new Map();
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    WebAssembly.instantiate = function(bytes, imports, ...args) {
      const env = imports?.env;
      if (env?.ui_text_mask) {
        const triangles = env.ui_triangles;
        env.ui_triangles = (surface,pointer,count,texture,...args) => {
          if (texture && !masks.has(texture)) images.add(texture);
          if (masks.has(texture)) {
            const vertices = new Float32Array(env.__linear_memory.buffer, pointer, count * 8);
            let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
            for (let index=0;index<count;index++) {
              const x=vertices[index*8], y=vertices[index*8+1];
              left=Math.min(left,x);top=Math.min(top,y);
              right=Math.max(right,x);bottom=Math.max(bottom,y);
            }
            textBounds.push({text:masks.get(texture),x:left,y:top,width:right-left,height:bottom-top});
          }
          return triangles(surface,pointer,count,texture,...args);
        };
        const begin = env.ui_begin, mask = env.ui_text_mask, decoder = new TextDecoder();
        env.ui_begin = (...args) => { drawn = []; textBounds = []; return begin(...args); };
        env.ui_text_mask = (font, pointer, count, ...args) => {
          const result = mask(font, pointer, count, ...args);
          if (result) {
            const text=decoder.decode(new Uint8Array(env.__linear_memory.buffer, pointer, count));
            masks.set(result,text);drawn.push(text);
          }
          return result;
        };
      }
      return instantiate(bytes, imports, ...args);
    };
    let paints = 0;
    const requestFrame = requestAnimationFrame.bind(window);
    const cancelFrame = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = requestFrame(time => { frames.delete(id); callback(time); });
      frames.add(id); return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id); cancelFrame(id); };
    const graphicsMode = ${JSON.stringify(graphicsMode)};
    let api = null;
    if (graphicsMode === 'webgl-no-api') {
      Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
    }
    if (graphicsMode === 'webgl-no-adapter') {
      Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true,
        get: () => ({ requestAdapter: async () => null }) });
    }
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      const context = getContext.call(this, kind, ...args);
      if (context && (kind === 'webgpu' || kind === 'webgl2')) api = kind;
      if (context && kind === 'webgl2') {
        const clear = context.clear.bind(context);
        context.clear = bits => { clear(bits); paints++; };
      }
      return context;
    };
    const gpu = navigator.gpu;
    if (gpu) {
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async options => {
      const adapter = await requestAdapter(options);
      if (adapter === null) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async options => {
        const device = await requestDevice(options);
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = commands => { submit(commands); paints++; };
        return device;
      };
      return adapter;
    };
    }
    window.uiTest = { drawn: () => drawn, texts: () => textBounds, images: () => images.size, stats() {
      const canvas = document.querySelector('canvas');
      return canvas ? [{ paints, api, scheduled: frames.size > 0,
        width: canvas.clientWidth, height: canvas.clientHeight }] : [];
    } };
  ` });
  await command('Browser.grantPermissions', { origin: `http://127.0.0.1:${server.address().port}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await waitFor('window.uiTest?.stats()[0]?.paints > 0 && !window.uiTest.stats()[0].scheduled');
  if (example === 'pictures') await waitFor('window.uiTest.images() >= 2 && !window.uiTest.stats()[0].scheduled');
  const before = await evaluate('window.uiTest.stats()[0]');
  assert.equal(before.api, graphicsMode === 'webgpu' ? 'webgpu' :
    graphicsMode.startsWith('webgl-') ? 'webgl2' : before.api);
  await pause(400);
  assert.equal((await evaluate('window.uiTest.stats()[0]')).paints, before.paints, 'Static UI must not repaint');
  await fs.mkdir('.cache', { recursive: true });
  const screenshot = async name => {
    const result = await command('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(result.data, 'base64'), chunks = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert(new Set(inflateSync(Buffer.concat(chunks))).size > 32, 'The browser screenshot is blank');
    await fs.writeFile(`.cache/${name}-${graphicsMode}.png`, png);
    return result.data;
  };
  const initialImage = await screenshot(`${example}-browser`);
  const motion = (x, y) => command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y) => {
    await motion(x, y);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
  };
  const key = async (key, code, virtualKeyCode, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: virtualKeyCode, modifiers
    });
  };
  const settled = () => waitFor('window.uiTest.stats()[0] && !window.uiTest.stats()[0].scheduled');
  if (example === 'ribbon') {
    await click(184, 77); await settled();
    assert.notEqual(await screenshot('ribbon-browser-insert'), initialImage, 'Changing tabs must change commands');
    await click(62, 150); await settled(); await screenshot('ribbon-browser-popup');
    await key('Escape', 'Escape', 27); await settled();
    await command('Emulation.setDeviceMetricsOverride', { width: 960, height: 700, deviceScaleFactor: 2, mobile: false });
    await click(260, 77); await settled(); await screenshot('ribbon-browser-narrow');
    await click(932, 156); await settled(); await screenshot('ribbon-browser-scrolled');
    await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 155, deltaX: -600, deltaY: 0 });
    await settled();
  } else if (example === 'snake') {
    // The 1120 x 760 design fits the 1280 x 800 viewport at 800/760.
    const x = value => (1280 - 1120 * 800 / 760) / 2 + value * 800 / 760;
    const y = value => value * 800 / 760;
    await click(x(170), y(432)); await pause(500);
    const running = (await evaluate('window.uiTest.stats()[0]')).paints;
    assert(running > before.paints + 2, 'Playing Snake must animate');
    await key('Escape', 'Escape', 27); await settled(); await screenshot('snake-browser-paused');
    const paused = (await evaluate('window.uiTest.stats()[0]')).paints;
    await pause(300);
    assert.equal((await evaluate('window.uiTest.stats()[0]')).paints, paused, 'Paused Snake must stop repainting');
    await key('Escape', 'Escape', 27); await pause(250);
    assert((await evaluate('window.uiTest.stats()[0]')).paints > paused, 'Escape must resume the run');
    await key('Escape', 'Escape', 27); await settled();
  } else if (example === 'text') {
    await click(33, 450); await settled();
    assert.equal(await evaluate('document.activeElement.tagName'), 'CANVAS',
      'Selecting read-only text activated the browser text editor');
    await click(180, 250);
    assert.equal(await evaluate('document.querySelector("canvas").style.cursor'), 'text');
    await key('a', 'KeyA', 65, 2);
    await command('Input.insertText', { text: 'Café 🙂' });
    await key('ArrowLeft', 'ArrowLeft', 37, 8);
    await key('c', 'KeyC', 67, 2); await settled();
    await waitFor(`navigator.clipboard.readText().then(text => text === '🙂')`);
    await key('Backspace', 'Backspace', 8);
    await key('a', 'KeyA', 65, 2); await key('c', 'KeyC', 67, 2); await settled();
    await waitFor(`navigator.clipboard.readText().then(text => text === 'Café ')`);
    // A long line must be clipped before rasterization, even at high density.
    await command('Input.insertText', { text: 'a'.repeat(5000) + 'é' }); await settled();
    await screenshot('text-browser-long');
    await key('a', 'KeyA', 65, 2); await key('c', 'KeyC', 67, 2); await settled();
    await waitFor(`navigator.clipboard.readText().then(text => text.length === 5001 && text.endsWith('é'))`);
    await command('Input.insertText', { text: 'A brighter way forward' }); await settled();
    await screenshot('text-browser-edited');
    await motion(33, 450);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 33, y: 450 });
    await motion(400, 498);
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 400, y: 498 });
    await key('c', 'KeyC', 67, 2); await settled();
    await waitFor('navigator.clipboard.readText().then(text => text.startsWith(' + JSON.stringify('Drag across this sentence to select text in the canvas.\nThe same') + '))');
    await screenshot('text-browser-selected');
    await evaluate('document.querySelector("main").style.display = "none"');
    await waitFor('window.uiTest.stats()[0].width === 0 && !window.uiTest.stats()[0].scheduled');
    const hiddenPaints = (await evaluate('window.uiTest.stats()[0]')).paints;
    await pause(250);
    assert.equal((await evaluate('window.uiTest.stats()[0]')).paints, hiddenPaints);
    assert.equal((await evaluate('window.uiTest.stats()[0]')).scheduled, false, 'A hidden surface kept requesting frames');
    await evaluate('document.querySelector("main").style.display = ""');
    await waitFor(`window.uiTest.stats()[0].paints > ${hiddenPaints} && !window.uiTest.stats()[0].scheduled`);
    await screenshot('text-browser-restored');
    await evaluate(`(async () => {
      const { createFontServices } = await import('/platform/fonts.js');
      const resources = new Map(); let sequence = 0, textures = 0;
      const service = createFontServices({
        mask(surface, pixels, width, height) { textures++; return { texture: {}, width, height }; },
        retire() {}
      }, new Map([['test', { family: 'sans-serif', weight:400 }]]), resources, () => ++sequence);
      const font = service.open({}, 'test', 15);
      const first = service.mask(font, 'Reusable text', 1, -1000, -1000, 1000, 1000);
      const moved = service.mask(font, 'Reusable text', 1, -500, -500, 500, 500);
      if (first !== moved || textures !== 1) throw new Error('Moving a clip rerasterized fully visible text');
      const clipped = service.mask(font, 'Reusable text', 1, 0, -500, 5, 500);
      if (clipped === first || textures !== 2) throw new Error('A changed text crop reused the wrong mask');
      service.close(font);
      if (resources.size !== 0) throw new Error('Closing the font retained masks');
    })()`);

  } else if (process.argv[5]) {
    const {verify} = await import(pathToFileURL(path.resolve(process.argv[5])));
    await verify({click,key,evaluate,command,waitFor,settled,screenshot});
  } else if (example === 'commands') {
    const {verifyCommands}=await import('./commands.mjs');
    await verifyCommands({click,key,evaluate,command,waitFor,settled,screenshot});
  } else if (example === 'editor') {
    const { verifyEditor } = await import('./editor.mjs');
    await verifyEditor({ click, key, evaluate, command, waitFor, settled, screenshot });
  } else if (example === 'forms') {
    const { verifyForms } = await import('./forms.mjs');
    await verifyForms({ click, key, evaluate, command, waitFor, settled, screenshot });
  } else if (example === 'pictures') {
    let image=readPng(await screenshot('pictures-decoded'));
    assert.deepEqual(image.pixel(580,80),[255,0,0]);
    assert.deepEqual(image.pixel(700,80),[0,200,100]);
    await click(640,180); await waitFor('window.uiTest.images() >= 3'); await settled();
    image=readPng(await screenshot('pictures-replaced'));
    assert.deepEqual(image.pixel(580,80),[36,90,207]);
    assert.deepEqual(image.pixel(700,80),[239,179,40]);
  } else throw new Error(`Unknown example: ${example}`);
  const after = await evaluate('window.uiTest.stats()[0]');
  assert(after.paints > before.paints, 'Interaction must repaint');
  await motion(0, 0); await settled();
  const idle = (await evaluate('window.uiTest.stats()[0]')).paints;
  await pause(400);
  assert.equal((await evaluate('window.uiTest.stats()[0]')).paints, idle, 'Animations must settle');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await evaluate('import("/platform/start.js").then(({application}) => application.close())');
  assert.deepEqual(await evaluate('window.uiTest.stats()'), []);
  assert.equal(await evaluate('document.querySelectorAll("canvas, textarea").length'), 0);
  await pause(100);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await evaluate('import("/__tests__/rendering.mjs").then(async module => { await module.verifyRendering(); await module.verifyShaderBuffers(); await module.verifyShaderUniforms(); await module.verifyCompiledShaderUniforms(); await module.verifyFailureBoundaries(); })');
  await evaluate('import("/__tests__/scene-rendering.mjs").then(module => module.verifySceneBuffers())');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ example, graphicsMode, before, after, errors }));
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  socket?.close();
  if (chrome.exitCode === null) {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    process.kill(-chrome.pid, 'SIGTERM');
    await stopped;
  }
  await new Promise(resolve => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
