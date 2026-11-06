# DynLex UI

One DynLex UI engine for native windows and browser canvases. Immutable section
descriptions define the interface; instances hold values and callbacks. Layout,
SVG icon placement, antialiased geometry, transitions, hit testing, text selection,
single-line editing and redraw decisions are shared DynLex code.

The native adapter submits to Vulkan through DynLex's graphics library. The browser
adapter submits the same vertices to WebGPU. JavaScript supplies browser services:
GPU resources, fonts and SVG coverage, clipboard, event normalization and scheduling.
The browser ships ahead-of-time application WebAssembly, without the compiler.
The HTML page contains the canvas host; an invisible input bridge receives OS text
and IME events. Application UI needs no HTML or CSS.

## Try it

Use the compiler changes on `codex/ui-framework` until they are merged into DynLex.
From this checkout, with the built compiler checkout at `../dynlex`:

```sh
python3 scripts/build.py ribbon --dynlex ../dynlex
python3 -m http.server --directory dist/ribbon 8000
```

Visit `http://localhost:8000`. WebGPU requires a secure context (localhost or HTTPS)
and a WebGPU-capable browser. There is no alternate renderer. Build `snake` or `text`
instead of `ribbon` for the game or selection/editor demo.

For native:

```sh
python3 scripts/build.py ribbon --dynlex ../dynlex --target native
./build/ribbon.out
```

Run native executables with this checkout as their working directory so font assets
resolve. Native dependencies are DynLex's Vulkan, GLFW and FreeType dependencies.

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
separate Chrome profile on Xvfb with WebGPU software rendering, capture nonblank
screenshots, interact with the canvas and check that idle paint counts stay fixed.
These checks require Node 22+, Chrome, X11 and `xvfb-run` in addition to the compiler.
They never use the desktop display or an existing browser profile.

`ui/` contains the shared engine; `platform/` contains adapters; `assets/` contains
licensed fonts and SVG sources. Regenerate icons with
`python3 scripts/generate_ui_icons.py` and verify with `scripts/test_ui_svg.py`.
