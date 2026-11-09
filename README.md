# DynLex UI

One DynLex UI engine for native windows and browser canvases. Immutable section
descriptions define the interface; instances hold values and callbacks. Layout,
SVG icon placement, antialiased geometry, transitions, hit testing, text selection,
single-line editing and redraw decisions are shared DynLex code.

The native adapter submits to Vulkan through DynLex's graphics library. The browser
adapter submits the same vertices to WebGPU or WebGL2. JavaScript supplies browser services:
GPU resources, fonts and SVG coverage, clipboard, event normalization and scheduling.
The browser ships ahead-of-time application WebAssembly, without the compiler.
The HTML page contains the canvas host; an invisible input bridge receives OS text
and IME events. Application UI needs no HTML or CSS.

## Try it

Use a built checkout of DynLex local master.
From this checkout, with the built compiler checkout at `../dynlex`:

```sh
python3 scripts/build.py ribbon --dynlex ../dynlex
python3 -m http.server --directory dist/ribbon 8000
```

Visit `http://localhost:8000` in your normal browser. The host prefers WebGPU when
it can acquire a device; otherwise it selects WebGL2 before creating any surfaces.
The selection and shader-program services are shared with the DynLex homepage and
IDE through `web/graphics-backend.js`, copied from the DynLex checkout by the build.
Both transports consume the same geometry, clipping and coverage masks, with
linear-light blending and sRGB presentation. Rendering failures after selection
are reported rather than triggering a backend switch. WebGPU requires a secure
context (localhost or HTTPS); WebGL2 also supports browsers without the WebGPU API.
Build `snake` or `text` instead of `ribbon` for the game or selection/editor demo.

For native:

```sh
python3 scripts/build.py ribbon --dynlex ../dynlex --target native
./build/ribbon.out
```

Run native executables with this checkout as their working directory so font assets
resolve. Native dependencies are DynLex's Vulkan, GLFW and FreeType dependencies.

## Games and visual studies

The [game examples](examples/games/README.md) include classic cube Geometry Dash,
LEXI-8 Breakout, five shader studies, a color cube, city flyover and typography.
Snake remains in `examples/snake`. Build and launch any native example from any
directory with absolute checkout paths:

```sh
python3 /home/jan/Documents/Github/dynlex-ui/scripts/play_game.py geometry --dynlex /home/jan/Documents/Github/dynlex
```

Use `breakout`, `snake`, `shaders`, `mandelbrot`, `plasma`, `event-horizon`, `cube`,
`city` or `typography` in place of `geometry`. Gameplay, UI input and painting use
the shared UI engine; custom SPIR-V shaders and 3D scenes use the native adapter.

## Authoring

```text
window project window:
    heading "Your projects"
    text field "Name" containing "Quarterly story"
    toolbar:
        button "New Project"
        button "Draw"
    code:
        when the "New Project" button is clicked:
            set this window's status to "Project created"
```

The declaration is static data and opens nothing. Create an instance and a view,
then run it. Both adapters accept the same `UI driver` record. Internal imports are file-relative,
so another project can import `/path/to/dynlex-ui/ui/native.dl` or `ui/browser.dl`
without using this checkout as its working directory. Font paths are supplied by
the application. See
[the ribbon interface](examples/ribbon/interface.dl), [the text example](examples/text),
and [section authoring](docs/sections.md). Each demo keeps its description, application
behavior and platform entry points separate.

A view paints on first use, changes, resize or an active transition. Native windows
wait for events while idle; browser canvases stop requesting animation frames.
Transitions snap to their destination and stop. All queued inputs are processed,
including a press/release pair received before the next paint.

Text selection and editing use UTF-8 scalar boundaries and measured advances on
both platforms. Clipboard copy/cut/paste and browser IME composition are supported.
This is not yet a shaping engine: grapheme-cluster navigation, bidirectional editing,
rich text and a screen-reader semantic tree are not implemented. Native glyph coverage comes from the chosen font; browsers may use their platform
font fallback for missing glyphs. Browser font masks are clipped before rasterization,
so long fields do not allocate textures as wide as their entire contents.

## Tests

```sh
python3 scripts/test.py --dynlex ../dynlex
python3 scripts/test.py --dynlex ../dynlex --native --browser
```

Shared fixtures run at `-O0` and `-O2`. Native checks exercise the actual ribbon,
Snake, table window and editor on private Xvfb displays. Browser checks use a
separate Chrome profiles on Xvfb with software GPU drivers. Each demo runs with
WebGPU, with an exposed WebGPU API returning no adapter, and with no WebGPU API.
Checks capture nonblank screenshots, interact with the canvas, check that idle
paint counts stay fixed, and verify blending, mask upload and clipping pixels on
both transports. Software-driver flags are confined to these isolated tests.
These checks require Node 22+, Chrome, X11 and `xvfb-run` in addition to the compiler.
They never use the desktop display or an existing browser profile.

`ui/` contains the shared engine; `platform/` contains adapters; `assets/` contains
licensed fonts and SVG sources. Regenerate icons with
`python3 scripts/generate_ui_icons.py` and verify with `scripts/test_ui_svg.py`.
