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

From this checkout, with a built DynLex compiler checkout at `../dynlex`:

```sh
python3 scripts/build.py ribbon --dynlex ../dynlex
python3 -m http.server --directory dist/ribbon 8000
```

To package an application from another source file, use `--entry path/to/app.dl`
in place of the example name. The entry selects its native or browser adapter;
`--target native` builds an executable. `--output` chooses the output location.

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
Native pictures additionally use the GdkPixbuf 2 image codecs and GLib runtime.
Install loaders for the formats your application uses; the image tests exercise
PNG, WebP, SVG and JPEG. The decoder modules load when a picture is first used.

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
and [section authoring](docs/sections.md). [Responsive documents](docs/documents.md)
cover appearances, rich paragraphs, editors and tab groups. [Shader surfaces](docs/shaders.md)
cover typed vertex streams, instanced draw records and the shared driver API. Each demo keeps its description, application
behavior and platform entry points separate.

A view paints on first use, changes, resize or an active transition. Native windows
wait for events while idle; browser canvases stop requesting animation frames.
Transitions snap to their destination and stop. All queued inputs are processed,
including a press/release pair received before the next paint.

Text selection and editing use UTF-8 scalar boundaries and measured advances on
both platforms. Clipboard copy/cut/paste and browser IME composition are supported.
The shared renderer positions native text input at the active caret. Browser IME
composition works in single-line fields and multiline editors, with commit,
cancellation and undo; read-only content does not activate the text input bridge.
Documents also support responsive fields, switches, choice lists, rich paragraphs,
source-anchored selection, multiline editing and undo/redo.
`ui/source_workspace.dl` supplies reusable source documents,
project-aware language analysis, semantic colors and mapped diagnostics for both
drivers; applications supply project metadata and a language transport.
`ui/source_tools.dl` adds the shared completion popup: Ctrl+Space requests it,
arrows or the pointer select a suggestion, Enter/Tab accepts it as one undoable
edit, and Escape dismisses it. Completion commands continue through a pattern's
next argument. All requests use the document's prefix and Unicode coordinates;
edits to protected context are rejected together with their other edits.
Hover inspection uses the same delayed language query and selectable text
popover in standalone and embedded editors, including read-only imports. Type
and value text can be selected and copied without including the page behind it.
Enable tools with `enable UI source tools for workspace in view`, and call
`update UI source tools in workspace` before scheduling language work each frame.
Changing the token theme refreshes every editor from its existing analysis; an
unchanged theme preserves cached colors. `read only editor` and `read only text
field` retain selection, copying and navigation while excluding editing and IME.
The same policy can change at runtime with `set UI control node read only true in
instance`; programmatic `set the text of` updates still work.
Dynamic read-only changes survive definition visits and returns, including policy
changes made while viewing an imported source. Imported text stays protected.
Semantic themes share type and modifier selectors, including combinations and
wildcards. The default nested-call colors come from the compiler's canonical
palette; `python3 scripts/generate_source_colors.py --dynlex <compiler-checkout>` updates
their static declarations. Each document retains its own modifier legend and
invalidates colors when that legend changes.
Suggestions follow typed characters and committed IME words. Paste and newlines
keep the code surface clear, and Ctrl+Space remains available explicitly. Popups
inherit their editor's font and colors. Multiline editors keep them inside the
code area; compact fields place them in the available space beside the field.
The same workspace can contain plain editors and editors with hidden vocabulary
imports. No application-specific completion handlers are needed. F12 follows definitions
into retained read-only imported sources; Alt+Left returns to the preceding file
and selection. `source pane "Plan" containing text using appearance` composes the
same editor with scoped Back/Main file, Outline, Instances and Fixes controls and a
filename. F9 opens the nested document outline; F8 chooses the inferred instance
at the caret. Both inspection tools work on read-only sources and preserve
editing focus. Instance selection refreshes colors and hover values after the
language service acknowledges it. F7 opens quick fixes for the selection. Fixes
refresh diagnostic context when the request is dispatched, apply through the
shared Unicode edit planner, and make one undoable change per source. Imported
and application read-only text remain protected. Applications read
`the UI main source of editor in workspace at seconds seconds` for Run or Save,
so opening a definition never changes the program they execute. Program loads
use `load UI main source of editor in view from text at seconds seconds`; this
starts fresh editing and navigation state without taking another control's focus.
Host capabilities use `ui/services.dl`. Applications receive a `UI service provider`
separately from their renderer; immediate calls, asynchronous requests and
cancellation carry its context and the target view. The browser adapter supplies
`the browser UI service provider`, with replies delivered through the shared
input queue.
Window dimensions, font sizes and shader operation arguments share checked
32-bit driver conversion. Wider public integers retain their values when they
fit; out-of-range values fail before conversion.
Grapheme-cluster navigation, bidirectional editing and a
screen-reader semantic tree are not implemented. Native glyph coverage comes from the chosen font; browsers may use their platform
font fallback for missing glyphs. Browser font masks are clipped before rasterization,
so long fields do not allocate textures as wide as their entire contents.

## Tests

```sh
python3 scripts/test.py --dynlex ../dynlex
python3 scripts/test.py --dynlex /absolute/path/to/dynlex --case shared/source_hover
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
