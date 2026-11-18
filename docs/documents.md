# Responsive documents

`ui/document_declarations.dl` defines document sections as ordinary DynLex data.
The renderer uses the same description on native windows and browser canvases.
Named appearances contain inherited typography and responsive layout rules.

```dynlex
appearance page appearance:
    maximum width is 1000
    padding is 32
    gap is 24
    when viewport is below 700:
        padding is 16

appearance editor appearance:
    height is 300
    font size is 14
    lines do not wrap

document workspace using page appearance:
    paragraph "Title" containing "Working ideas" using no UI appearance
    tab group "Files" using page appearance:
        tab "main.dl":
            text surface "Main source" containing "print line 42" using editor appearance
        tab "notes":
            paragraph "Notes" containing "Define the interface first." using no UI appearance
    paragraph "Output" containing "" using no UI appearance
```

Names remain stable when content changes. In the controller:

```dynlex
set instance to an instance of workspace
set the text of "Output" in (the address of instance) to "42"
set the value of "Files" in (the address of instance) to 1
```

Model changes made during a canvas paint callback reflow on the next frame.
Changes made by a frame callback participate in that frame's layout. Once those
changes have been painted, an unchanged view remains idle.

A surface's painting callback runs only when its bounds intersect the current
clip. A partly visible surface still paints; scrolling it completely out of view
stops paint-driven animation. Its retained layout and pointer bounds still update,
so returning to it resumes painting. Use a frame callback for application work
that must run independently of surface visibility.

Tab selection is zero-based. Mouse, arrow keys, Home and End use the same
selection state. In a document, Tab enters the selected header and then its
active panel; inactive panels retain their editor values and undo history.
`the active UI editor within group in instance` resolves the selected editor
without coupling a controller to the number or names of its tabs.

A `view group` can select `-1` to show no panel. The group then leaves the
document flow, including its padding and surrounding gaps. It keeps its controls,
editor drafts and undo history for the next selection. Hidden panels cannot
receive pointer hits, keyboard commands or popup choices. Tab groups always keep
a selected tab; `-1` is specific to optional views.

A `view group` selects a panel without adding tab headers. Its children can be
any document elements; inactive panels retain their values and undo history and
do not participate in painting or keyboard focus. This lets one set of tabs
control a second region:

```dynlex
view group "Results" using no UI appearance:
    paragraph "Program output" containing "Ready." using no UI appearance
    surface "Shader preview" using no UI appearance

set the value of "Results" in (the address of instance) to (the value of "Files" in (the address of instance))
```

Nonnegative selections are zero-based and must identify an existing child.

Named palettes let controllers change colors without changing declarations:

```dynlex
palette daylight colors:
    color "Paper" is UI ink 250 250 249
    color "Text" is UI ink 30 34 40

palette midnight colors:
    color "Paper" is UI ink 18 24 32
    color "Text" is UI ink 235 240 246

appearance themed paper appearance:
    background is palette color "Paper"
    text is palette color "Text"

use UI palette daylight colors in (the address of instance)
```

`border is palette color "Name"` also accepts a named color. An appearance
can set `accent is palette color "Name"`; `accent is UI ink 40 90 180`
uses a literal. Accents inherit through document regions and color range tracks,
switches and field focus outlines.

Palette entries are static data; each instance selects its own palette. Names must be nonempty
and unique, and every referenced color must exist. Selecting a different palette
invalidates the instance's views and preserves editor drafts, selections and undo
history. Selecting the same palette leaves an unchanged view idle. Literal inks
can be mixed with named colors. Standalone resolution uses
`UI appearance appearance resolved for width using palette`; use `no UI palette`
when the appearance contains only literal inks.

`paragraph "Name" containing "Text"` separates an element's name from its initial
content, including empty content. Editors use that same distinction. Links store
their destinations separately from content and visual variants.

Ranges declare their limits, step and initial value as immutable data:

```dynlex
document preview:
    range field "Frame" from 0.0 through 100.0 stepping 0.5 initially 50.0 using no UI appearance
    paragraph "Frame preview" containing "50" using no UI appearance
    code:
        when the "Frame" control changes:
            set the text of "Frame preview" in this window to (the string form of (the range value of "Frame" in this window))
```

The callback body is application code. `the range value of "Frame" in instance`
returns a floating-point value. `set the range value of "Frame" in instance to
amount` clamps to the bounds, snaps interior values to the nearest step and
invalidates only a changed value. Programmatic assignments do not invoke input
callbacks. Equal bounds describe a fixed value; bounds, initial values and steps
must be finite, and steps must be positive.

Pointer input captures a drag until release, including outside the field.
Arrow keys adjust one step, Page Up and Page Down adjust ten, and Home and End
reach the bounds. Disabled ranges reject input and leave keyboard navigation.
Documents and classic windows use the same value, input and painting code.

Single-line fields, switches and choices participate in document layout and use
the same input, undo, focus and activation code as classic windows and ribbons:

```dynlex
appearance preferences appearance:
    columns are 2
    gap is 12
    when viewport is below 500:
        columns are 1

appearance field appearance:
    padding is 12
    font size is 18
    minimum height is 48

document preferences using preferences appearance:
    text field "Name" containing "Ada" using field appearance
    switch "Auto save" using field appearance
    choice field "Mode" choosing "Focused" using field appearance:
        choice "Focused"
        choice "Calm"
        choice "Code review"
```

The choice field's name is independent of its selected text. Read or set its
text with `the UI value for node in instance` or `set the text of "Mode" in
instance to "Calm"`; its numeric value is the selected zero-based index. Choices
must be nonempty and the initial text must identify an option. Bind changes to
event 0, just as for buttons. Single-line fields remove line breaks from initial,
programmatic, typed, pasted and composed text. `read only text field "Name"
containing "Ada" using field appearance` retains selection and copying.

Dropdowns share `UI choice popover` with source completion and diagnostics. Lists
stay inside the viewport, display up to eight rows, reveal the selected row and
skip disabled items. Arrow keys, Home/End, Page Up/Down, wheel, Enter/Space and
Escape work without changing the selected value until acceptance. Dropdown
pointer activation happens on release; source completion retains activation on
press. Popups inherit document typography and colors, including dark surfaces.
Choice placement takes anchor bounds, so both tall controls and transformed code
carets can open their lists above or below without assuming a fixed line height.

Regions support columns, maximum widths, stacking thresholds, padding, gaps,
overlays and sticky positioning. Paragraphs support inline `words` and `link`
sections; selection copies their source text through line wrapping and reflow.
Borders preserve transparent interiors over pictures and shader surfaces.
Custom surfaces can use `ui/texture_shapes.dl` to draw a texture rounded by a
radius, with smooth edge coverage and optional opacity. Its geometry and texture
coordinates are shared across native and browser drivers.

Editors accept source-bound annotations from any language service or controller:

```dynlex
import ui/text_colors.dl

set editor to the control labeled "Main source" in (the address of instance)
color UI text (the string form of "print line 42") in editor in (the address of instance)
add UI text color (UI ink 210 170 240) from 0 to 10 in editor in (the address of instance)
add UI text color (UI ink 230 196 124) from 11 to 13 in editor in (the address of instance)
```

Offsets are UTF-8 bytes; spans must be ordered, disjoint and on character
boundaries. Colors apply only while the editor matches their source snapshot.
Selection, copying and caret navigation retain the original source coordinates.
Starting another color set releases the old spans; closing the instance releases
its annotations. The UI library does not parse language tokens.

Composition temporarily replaces the selected source range in the presentation,
including line wrapping, scrolling and the caret. The surrounding source keeps
its semantic colors. Committing creates one undoable edit; cancelling leaves the
source and history unchanged. Surface focus loss hides the caret and ends
composition while retaining the editor selection.

`view's input context` supplies the active editor, an input epoch, its complete
source and UTF-16 selection, the caret bounds in surface coordinates, and the
font and source-line offset used by native text services. The browser adapter
uses this context for its invisible IME input. Read-only selection and command
controls keep canvas keyboard focus. A source, selection or focus change retires
the previous input epoch, so delayed native events cannot overwrite a newly
loaded document.

See [sections](sections.md) for defining additional declarative shapes and
[the examples](../examples) for application and platform setup.

Pictures use the same description, fitting and texture geometry on both platforms:

```dynlex
appearance cover appearance:
    maximum width is 480
    height is 240
    corner radius is 16
    image fit is cover

document gallery:
    picture "Cover artwork" from "assets/cover.webp" using cover appearance

set the source of picture "Cover artwork" in (the address of instance) to (the string form of "assets/next.webp")
```

Without an explicit height, a decoded picture determines its height from its
source aspect ratio. `image fit is contain` fits the whole image; `cover` crops
it to fill the available box; `stretch` fills both dimensions. Padding and rounded
corners apply to the image geometry. The picture's name remains available as its
text description.

`UI image from path in view` also exposes a cached image for canvas callbacks.
Its status is 0 while loading, 1 when its texture is ready and 2 on a reported
decode failure. Use `draw UI image image in bounds rounded by radius fitting fit
on frame`, where fit is 0 for contain, 1 for cover or 2 for stretch.

Loading starts when the view receives its first update, after its final address
is established. Repeated paths share one decode within a view; separate views
own separate graphics resources. Completion schedules a redraw and reflows
intrinsic picture height. Static images do not schedule further frames. Closing
a view cancels its pending loads and releases its textures. Browser image errors
log their details and display the generic application error message.

An appearance can reserve responsive artwork or a canvas before it loads:

```dynlex
appearance scene appearance:
    aspect ratio is 16 by 9
    maximum width is 800

set the "Run" control in (the address of instance) enabled false
```

The ratio applies to the content width and adds padding outside it. Explicit
height takes precedence; minimum height still applies. Disabled input controls
keep their place in layout, paint in muted colors, and reject pointer, keyboard,
text and programmatic activation. Keyboard traversal and tab/menu navigation
skip them. Disabling an open menu owner prevents a queued selection from changing
it. Enable individual controls; containers do not inherit a disabled state.

`reload UI image from path in view` cancels a pending decode or releases the
current texture, then starts a fresh request. Use it for an explicit retry after
a failed asset load. It keeps the cached image's address and schedules a redraw.

Canvas code can composite a feathered detail from an image without replacing its
surrounding pixels:

```dynlex
draw UI texture texture across imageBounds sampling (UI box at 0 0 sized 1 1) masked by ellipseBounds opaque through 0.8 with opacity 255 on frame
```

The mask's bounds define an ellipse. The opaque fraction lies in `[0, 1)`; the
remaining outer ring fades to transparent. Sampling stays relative to the full
image bounds and supports mirrored UVs, just like other texture primitives.

Editors also accept source-bound background marks independently of token colors:

```dynlex
import ui/text_marks.dl

mark UI text source in layer "execution" at priority 10 in editor in (the address of instance)
add UI text mark (UI ink 104 153 178) from firstByte to lastByte with opacity 100 in layer "execution" in editor in (the address of instance)
```

Ranges use UTF-8 byte offsets and character boundaries, like token colors.
They may span lines and remain attached to their original source snapshot.
Drawing a mark preserves the content, selection, caret, undo history and semantic
colors. Composing text preserves the marks on its unchanged prefix and suffix;
a committed edit stops matching the previous snapshot. Each named layer has its
own snapshot and ordered, non-overlapping spans. Different layers may overlap;
lower priorities paint first. Replacing or clearing one layer preserves the
others, so search results can coexist with execution feedback. Use
`clear UI text marks in layer "execution" in editor in instance` to remove just
that layer; its boolean result reports whether anything changed. Closing the
instance releases every layer. The state-based variants work on parked document
buffers without switching the editor's visible file.

Canvas painters can request `a cached UI font from path sized size in view`.
The view owns this font and releases it when closed. Use the uncached font
constructor only when the caller will manage that font's lifetime itself.

Browser hosts can add `createAudioServices(base)` from `platform/browser/audio.js`
to their generic service table. It returns `{ services, close }`. `audio` requests
load decoded buffers, play voices, update their volume/rate, release voices and
unload buffers. Play remains pending until its voice ends; cancelling its request
stops the voice and reclaims its record, including cancellation before creation
or after completion but before delivery. Keep the returned buffer order and supply a distinct integer
voice identifier for each play. Release normally ended voices explicitly; cancelled and failed plays already
relinquish their resources.
`close()` stops all voices, releases buffers and closes the audio context.

Host capabilities use `ui/services.dl`, independently of the renderer. Supply a
`UI service provider` containing its context and call, request and cancellation
callbacks. `a UI request named name containing json through services in view`
returns a request ID; responses enter the shared input queue as kind 11.
The caller owns the provider and keeps its context alive until requests finish.
Handlers are typed callbacks: calls and requests receive context, view, name and
payload; cancellation receives context, view and request ID. Their return types
are `UI call result`, integer and boolean, respectively.
`cancel UI request id through services in view` reports whether delivery was cancelled.
The browser adapter supplies `the browser UI service provider` from
`platform/browser/requests.dl`.

For immediate capabilities, pass an explicit `synchronousServices` table to the
browser application host. `a UI call named name containing json through services in view`
returns a `UI call result` with `success` and `contents`. Successful
contents contain owned UTF-8 JSON. A failed provider is logged by the host and
returns `success = false`; provider error details never enter the application.
Storage and the epoch-millisecond `clock` capability from `createWebServices`
can be registered here so local saves finish within an edit event. Synchronous
providers must return JSON immediately; promises use the request API instead.

The `connectivity` web service watches platform connectivity. It emits an initial
`{type: "connectivity", online: boolean}` notification and subsequent online or
offline changes. Cancelling its request releases both event subscriptions; retry
decisions belong to the application's DynLex controller.

The `timer` web service resolves after its requested `milliseconds`, or cancels
with its request. Applications own scheduling and audio policy in DynLex.
The host processes queued input and service replies once when a browser tab is
hidden, because browsers suspend animation frames there. Hidden surfaces never
poll for animation; returning to a visible surface resumes normal scheduling.

Code editors, source panes and language services are documented in [dynlex-ide](https://github.com/OpenAEC-Foundation/dynlex-ide/blob/master/docs/editor.md).

## Selectable text popovers

`ui/text_popovers.dl` provides `a UI text popover containing text`. Callers supply
anchor bounds, viewport bounds, a view-owned font, and resolved appearance to
`paint UI text popover popover anchored at anchor within viewport using font
styled appearance on frame`. The popover uses the same paragraph layout, wrapping,
Unicode selection and copy engine as document text. Its overlay input callback
forwards to `read UI text popover popover in view`. Selection stays inside the
popover even when dragging outside it or using Select All. Escape or an outside
click dismisses it. Hovering the surface preserves the current text input;
clicking its text selects it and retires the preceding input context. A viewport
too small for its padding hides the surface until it becomes usable. Clear it with `clear UI text popover popover in view` before
its owner is released; this retires borrowed selection and paint runs immediately.

An overlay can publish its borrowed `layout` for the view's ordinary hit testing.
`record UI floating layout layout in box on frame` records paint order and clips
its pointer bounds. `retire UI floating layout layout` removes that geometry,
including descendants, immediately between paints. This prevents covered controls
from receiving hover or pointer actions. Text popovers supply this layout; their
owner assigns it to the overlay. Completion menus use the same hit path and keep
their captions outside document text selection.

Plain multiline input uses `text area "Query" containing "first\nsecond" using appearance`
(or `read only text area ...`). It shares selection, input methods, wrapping, scrolling
and undo with source editors, while source workspace discovery registers only
`editor` controls for language analysis. A plain text area is suitable for multiline
search and replace queries without creating a second language document. Named
background marks also work in plain text controls through the same layer API.

The browser font service shares measured metrics between layout and mask lookup.
Measurements belong to a loaded font handle, remain in logical pixels across
pixel-scale changes, and are released with the font. The FIFO cache bounds both
entry count and retained text; repeatedly drawing unchanged captions does not
measure them again or mutate cache insertion order.

For a controller that sets initial values before showing a document, construct
`an unmeasured UI view of instance sized width by height using fonts regular and bold with driver`.
It opens the surface and creates the layout tree without measuring the document.
Configure the controller, then run the view: the first update measures the final
initial content once. An ordinary `a UI view of ...` still provides immediate
layout. `update the UI viewport in view` explicitly measures a deferred view when
geometry is needed before running it. Layout records its own content revision,
viewport dimensions and image freshness, independently of the last paint.
Programmatic focus changes control identity without measuring the document.
Input dispatch prepares the current viewport after application input observers,
before hit testing and text handling; painting reuses that layout.

Inactive tab and selected-view bodies are measured when selected. Wrapped text
uses whole-line and word boundaries, splitting oversized words at UTF-8 boundaries.
Clipped rounded surfaces and outlines skip tessellation without changing paint
state. These paths are shared by native and browser drivers.

Browser application manifests identify fonts by their logical path and a delivery
source and weight, for example `{"path":"regular.ttf","source":"family.woff2","weight":400}`. Multiple
logical font paths can share one variable font download at different weights. The native
path stays unchanged. Required fonts load concurrently with streaming application
compilation and preparation of the first GPU surface. `tools/wasm_delivery.mjs`
separates optional Wasm debug names into a `.wasm.names` sidecar while preserving
executable code. No compiler is needed to start a built UI application.
