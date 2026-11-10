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
