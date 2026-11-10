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
            editor "Main source" containing "print line 42" using editor appearance
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

Tab selection is zero-based. Mouse, arrow keys, Home and End use the same
selection state. In a document, Tab enters the selected header and then its
active panel; inactive panels retain their editor values and undo history.
`the active UI editor within group in instance` resolves the selected editor
without coupling a controller to the number or names of its tabs.

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

Selection is zero-based and must identify an existing child.

`paragraph "Name" containing "Text"` separates an element's name from its initial
content, including empty content. Editors use that same distinction. Links store
their destinations separately from content and visual variants.

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

mark UI text source in editor in (the address of instance)
add UI text mark (UI ink 104 153 178) from firstByte to lastByte with opacity 100 in editor in (the address of instance)
```

Ranges use UTF-8 byte offsets and character boundaries, like token colors.
They may span lines and remain attached to their original source snapshot.
Drawing a mark preserves the content, selection, caret, undo history and semantic
colors. Composing text preserves the marks on its unchanged prefix and suffix;
a committed edit stops matching the previous snapshot. Starting a new mark set
releases its previous spans; closing the instance releases all remaining marks.

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

For immediate capabilities, pass an explicit `synchronousServices` table to the
browser application host. `a browser UI call named name containing json in view`
returns a `browser UI call result` with `success` and `contents`. Successful
contents contain owned UTF-8 JSON. A failed provider is logged by the host and
returns `success = false`; provider error details never enter the application.
Storage and the epoch-millisecond `clock` capability from `createWebServices`
can be registered here so local saves finish within an edit event. Synchronous
providers must return JSON immediately; promises use the request API instead.

The `timer` web service resolves after its requested `milliseconds`, or cancels
with its request. Applications own scheduling and audio policy in DynLex.
The host processes queued input and service replies once when a browser tab is
hidden, because browsers suspend animation frames there. Hidden surfaces never
poll for animation; returning to a visible surface resumes normal scheduling.
