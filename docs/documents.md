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

## Shared source editors

Import `ui/source_workspace.dl` to add language analysis to source controls.
A workspace discovers every `editor` in an instance and owns its document models.
It follows page and tab selection, prioritizes focused/visible sources, debounces
edits, and rejects results from older source revisions or project contexts.

```dynlex
set workspace to a UI source workspace in instance rooted at "file:///workspace"
set editor to the UI source editor labeled "Plan" in workspace
set files to a new JSON-RPC object
configure UI source document (editor's document) named "plan.dl" at "file:///workspace/plan.dl" prefixed by "import project/vocabulary.dl\n\n" using UI CPU analysis with files files
free files
```

Each source control starts with its own project, so examples that share `main.dl`
do not leak names or import suggestions into each other. The main document is
`editor's document's project's entry`. A project owns its `profiles`, `files`,
main document and imported document models. Additional files are copied; analysis
profiles are consumed. Profiles are JSON data, including CPU, fragment, and
combined vertex/fragment helpers; the client accepts arbitrary profile sets.

`the UI source files of project` returns an owned JSON source map for analysis or
execution, including the configured main filename, protected prefix and all
provided files. Free that snapshot after serialization. Synchronize its workspace
before collecting it so current edits are included. Later edits do not change the
snapshot, and collecting it does not modify the provided file map.

To retain imported source in the same project, use `a UI source document named
filename at uri containing source in project`. These models have no hidden prefix
and start read-only. `the UI source document at uri in project` returns an existing
model or a null pointer when the URI has not been loaded. Project changes
invalidate dependent analysis and queries without changing another file's source
revision when its contents stay the same. Replacing a provided file updates its
loaded snapshot and revision. Removing it marks that model unavailable; restoring
the file revives the retained model with current content. Imported libraries
outside the provided file map keep their snapshots. Read-only views follow the
document model, so their preceding control text cannot overwrite a replaced file.
Free standalone projects with `free UI source project project`; workspace
cleanup releases the projects belonging to its controls.

Import `ui/source_panes.dl` for `source pane "Plan" containing text using
appearance`. This is an ordinary immutable description containing an editor,
filename, Back, Main file, Outline, Instances and Fixes buttons. A workspace scopes those controls to their
pane. Bare editors and panes use identical document and interaction code.
Enable `ui/source_tools.dl` once per workspace for completion and F12 definition
navigation; Alt+Left returns through its location history. Visits retain each
file's independent undo/redo, annotations, Unicode selection and scroll position.
Imported sources are read-only; the main source's own read-only policy is restored
on return.
Runtime policy updates also survive navigation, including updates made while an
imported file is visible. Document protection and application policy share the
same editing gate, without overwriting each other's state.
Disabled controls use the shared foreground presentation rule for captions,
inline links and semantic text. Drawing retains authored appearances and token
colors, so enabling a control restores them. Read-only text keeps its colors.
Disabled inline links retire their hover underline immediately.

Token themes also accept modifier selectors, such as `function.callDepth1`,
`variable.constant`, `*.constant`, or `function.constant.callDepth1`. Modifier
names and bit positions come from each document's language-server legend. Rules
with more matching modifiers win; an exact token type wins over a wildcard at
equal modifier counts. The last rule wins a remaining tie. A rule naming an
unavailable modifier does not match. Modifier legends are retained per document,
so changing a connection's legend cannot recolor another retained project.
The default call colors are generated from DynLex's canonical
`shared/call-colors.json`. Run `python3 scripts/generate_source_colors.py
--dynlex <compiler-checkout>` after changing that palette. SDK export and shared
tests check that the generated declarations match it.

F9 opens an outline of authored sections, including nested declarations. Choosing
a section visits its selection range through the same Unicode and protected
context mapping as definition navigation. F8 lists inferred instances at the
caret and initially selects the compiler's current instance. Choosing another
instance notifies the language service, then refreshes semantic colors and hover
facts after acknowledgement. Both tools support read-only imports. Stale results
and acknowledgements are discarded when their source or project changes.

F7 opens diagnostic quick fixes for the selection. The request retains opaque
compiler diagnostic data, maps Unicode and hidden context through the shared
source model, and refreshes diagnostics immediately before dispatch. Opening
Fixes while analysis is pending therefore uses the completed analysis. Disabled
actions cannot be selected. Edits are staged and committed through the standard
text-edit planner, with one undo operation per changed source. A command following
an action uses the same command handler as completion.

`ui/source_transactions.dl` adapts workspace text edits to project-owned source
models. Prepare with `a UI source transaction applying edit for editor in view`,
then call `commit UI source transaction transaction in view` and free its owned
data with `free UI source transaction transaction`. Pass the transaction's address
to the latter two operations. Preparation synchronizes existing control edits,
then stages the requested changes. Commit rechecks source snapshots and access
policy before modifying any text. It updates all models and buffers before
notifying application handlers. Parked sources retain their own undo and caret;
updating one does not replace the visible imported source. Ordered versioned text
changes use the preceding staged snapshot. Invalid, stale, protected or read-only
targets reject the whole proposed edit. Resource operations such as creating,
renaming or deleting files belong to project storage and are not text edits.

`ui/choice_popovers.dl` supplies the same choice surface for completion and
inspection, without a JSON or language-service dependency. Callers add labels and
enabled states, supply placement, a borrowed view font and appearance, then handle
input results: 0 passes through, 1 consumes input, 2 activates the selected row,
and 3 requests dismissal. Arrows, Home/End, Page Up/Down, wheel and pointer input
share selection and scrolling. Disabled rows are skipped; an invisible menu
cannot activate a choice. Dismissal retires its hit geometry. Release owned rows
with `clear UI choice popover popup in view` before freeing the caller's state.

Source tools also provide pointer hover inspection in every registered source
control. Requests follow the document's protected-prefix/Unicode mapping and are
rejected when its source or project changes. The popover inherits its editor's
font and colors. Plain signatures and Markdown code descriptions retain literal
backticks and source escapes. Its text supports selection and copying; a short
leave interval allows crossing the gap from the inspected text into the popover.
Completion menus, composition and source-selection gestures take precedence.
An unchanged popover becomes idle.

Use `the UI main source of editor in workspace at seconds seconds` for Run, Save
or Share, rather than reading the currently displayed control. Use `the UI text
state for document in editor in instance` to apply execution marks to a parked
main source while an import is displayed.

`replace UI main source of editor in view with text at seconds seconds` starts a
fresh edit session for the main document without navigating away from an import.
It clears undo/redo and annotations and retires that control's IME context, even
when the incoming text is unchanged. `load UI main source of editor in view from
text at seconds seconds` also returns to the main file and clears navigation
history. Both accept borrowed source strings and preserve unrelated focus and
composition in other controls. Explicit `show UI source document document in
editor in view` focuses a document; `bind UI source document document in editor
in view` changes its presentation without taking focus.

The language client keeps one open model and version per file while retaining
its main file's inference context. Moving between files in a project does not
close them. Before answering an imported-file query, it synchronizes the main
source and refreshes dependent semantics without sending a text change for an
unchanged import. Leaving the project closes every open model before replacing
the source set.

Diagnostics belong to the project analysis snapshot. Reports are retained by URI,
including sources whose views have not been created. The main semantic-token
response is the ordered completion barrier for its analysis; committing that
snapshot clears old reports for clean imports as well. Opening a view applies
the retained report. Closed and superseded project replies do not overwrite it.
Changed reports advance a presentation generation independently of source edits;
identical reports preserve it.

During an update, call `the next UI source workspace work in workspace focused on
(the UI source focus in view for workspace) at (view's seconds) seconds`. A nonzero
`step` owns a JSON `payload` to send through the language transport. Deliver its
reply to `the UI language reply response at step step in (workspace's client)`;
that returns the next work item. Synchronize the workspace before delivering
replies so programmatic edits also invalidate outstanding results. The platform
implements `project`, `exchange`, and `reset`; document policy stays in DynLex.
A zero step has no payload. Free each sent payload after serializing it.

A query may set `parameters factory` to a DynLex function pointer receiving
`a pointer to UI source query` and `a pointer to UI source document`, returning
`nothing`. It refreshes the query's owned `parameters` in place after source
analysis and immediately before serialization. Preparing parameters preserves the
request's generation and cancellation rules. Each new request clears the slot's
previous callback. The complete `source_query_preparation` fixture exercises
dispatch and slot reuse; quick fixes use the hook for diagnostic context.

`present UI source workspace workspace using (the default UI source token theme)`
applies results to their source controls. Each binding may point `diagnostics`
and `status` at optional text controls. `clean text` and `ready text` configure
empty diagnostic and successful-analysis captions without changing editor policy. Source colors and diagnostics share UTF-16
to UTF-8 mapping through hidden imports, including same-line prefixes and astral
characters. Execution background marks remain independent. Theme entries are
ordinary `UI source token style` data. Call `free UI source workspace workspace`
before closing its UI instance. Transport failures should call `fail UI source
workspace workspace`; shared presentation then reports the failure in each active
source editor.

The shared client handles both directions of the language protocol. It replies
to semantic-token refresh requests and reports method-not-found for unsupported
server requests, preserving numeric and string identifiers. Replies are sent
before pending editor work resumes. A refresh requests tokens again without
resending unchanged source. Changed token data advances a separate presentation
generation, so inferred-instance choices can change colors without an edit.
Identical data retains cached colors.
Refreshes received after closing a document are acknowledged without invalidating
its retained results. A closed project stays idle until it needs analysis again.
The server's diagnostic clearing on close likewise leaves the editor's cached
results intact.

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
