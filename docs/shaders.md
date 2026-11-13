# Programmable shader surfaces

`ui/shaders.dl` supplies platform-independent buffer, draw and texture operations.
A view's `UI driver` holds a `UI shader operations` provider. The browser provider
implements those operations on the selected WebGPU or WebGL2 device. The native
adapter currently supplies the existing UI drawing API; it does not yet supply a
custom-program provider. Requesting an absent provider fails explicitly.

Applications define scene data, camera math, shader inputs, draw ranges and update
policy in DynLex. Host code owns program resources, transfers bytes and submits
GPU commands. Shader resources and their output textures belong to a surface.
Closing the resource releases its streams and output texture; closing a surface
releases every resource it owns.

Scene controllers can import `ui/invalidation.dl` to request a redraw or animate
a view without importing input dispatch or the application loop.

`ui/shader_programs.dl` shares source-stage descriptions, reflected uniform
binding linkage and program-input lookup. `UI shader linkage` contains either an
owned program or an error. Merged bindings copy their reflection data, reject
conflicting names or slots, and deduplicate bindings shared by both stages.
Applications supply their scene's vertex layouts, depth/blend settings and draws.

## Layout and source data

Each pass declares `vertexBuffers`, an array of layouts with `arrayStride`,
`stepMode` (`vertex` or `instance`) and `attributes`. Attributes specify
`shaderLocation`, byte `offset` and `format`. Supported formats are `float32`,
`sint32`, `uint32` and their `x2`, `x3`, `x4` vector forms. Strides and offsets
are four-byte aligned; each attribute must fit inside its record.

The graphics asset service also accepts a `source` on each layout: a binary
asset path or `null` for data supplied by DynLex. A pass's `indices` is a binary
unsigned-32-bit asset path or `null`. It loads the declared data and transfers its
bytes. DynLex determines the draw ranges, including counts for loaded assets
through buffer-record and index-count queries. Fullscreen passes explicitly draw
three vertices with no vertex streams.

```dynlex
set UI shader resource pass 0 in view vertex buffer 0 from bytes spanning size bytes
set UI shader resource pass 0 in view to indices indices counting count
set count to the record count of UI shader resource pass 0 buffer 0 in view
```

Uploads reuse an allocation while its capacity is sufficient. Logical ranges
follow the newly uploaded byte count, including shrinking and empty uploads.
Changing vertex contents without changing ranges preserves cached index-bound
validation. Index uploads snapshot their source before caller memory is reused.

## Typed inputs

Reflection describes every uniform as `type: {scalar, rows, columns}`. The scalar
is `float32`, `sint32` or `uint32`. Scalars and vectors occupy sixteen bytes;
float matrices occupy one sixteen-byte slot per row. Matrices have two through
four rows and columns. Integer vectors preserve all 32 bits, including uint32's
upper half. Linking requires stages to agree on the full type.

DynLex owns and packs each `UI shader value`. The host receives numeric bytes
through the shader driver, without JSON serialization or numeric repacking.
Updates persist until replaced; rendering requires every active input to have
been supplied. An optimized-out WebGL block needs no GPU allocation, while its
declared type still applies to uploads.

```dynlex
set light to a UI float shader vector from [0.4,0.8,0.2]
set flags to a UI unsigned shader value from 4294967295
set camera to a UI shader value from graphics matrix matrix
set UI shader resource pass 0 in view uniform group 0 binding 1 to camera
set UI shader resource pass 0 in view uniform group 0 binding 2 to light
set UI shader resource pass 0 in view uniform group 0 binding 3 to flags
```

The graphics-matrix constructor transposes column-major graphics matrices into
shader row vectors. `a UI float shader matrix from values with 3 rows and 2 columns`
accepts a flat row-major array and inserts the required padding. Values own their
storage, so copying one or returning it from a function does not borrow locals.

## Draw records

`UI shader draw` is six unsigned 32-bit words, in this order:

Its constructor accepts values from zero through 2,147,483,647 for counts and
offsets, matching the portable backend range. It checks that range before
converting wider integer arguments to the stored 32-bit representation.

Shader operations accept any integer width within that range, then pass the
provider's fixed 32-bit representation. Texture dimensions must also be positive.

| Field | Meaning |
| --- | --- |
| `count` | Number of vertices or indices |
| `instances` | Number of instances |
| `first` | First vertex or first index within the rebound streams |
| `vertex offset` | Record offset applied to every per-vertex stream |
| `instance offset` | Record offset applied to every per-instance stream |
| `indexed` | 0 for vertices, 1 for unsigned-32-bit indices |

Offsets select buffer records. Builtin vertex IDs follow the draw's first/index
values and instance IDs start at zero on both backends. Buffer offsets do not
change those IDs. This uses vertex-buffer binding offsets and
keeps the two APIs' builtin-ID behavior consistent. The rules follow the
[WebGPU draw and buffer-binding model](https://www.w3.org/TR/webgpu/#dom-gpurendercommandsmixin-drawindexed)
and [WebGL2 instanced vertex attributes](https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.9).

```dynlex
set draws to [
    a UI shader draw counting 36 instanced 20 starting at 0 with vertex offset 0 and instance offset 5 indexed true
]
set UI shader resource pass 0 in view to draws (draws + 0) counting 1
set image to a UI texture from shader resource sized width by height in view
```

`the JSON form of UI shader draw draw` produces the equivalent program-description
object. A pass includes a `draws` array, which may initially be empty while DynLex
prepares its buffers. Zero-count draws produce no primitives. Nonempty draws must
fit every bound vertex and instance stream and the requested index range.

## Images, samplers and attachment data

`ui/shader_resources.dl` describes named color/depth images and independent
samplers as ordinary data. Images can use fixed or frame-sized extents, six cube
faces, mip levels, and one or four samples. Formats are `rgba8unorm`,
`rgba8unorm-srgb`, `rgba16float`, `depth24plus` and `depth32float`.
`ui/shader_attachments.dl` adds subresource views, color/depth load and store
operations, resolve targets and independent culling/depth/blend state.

```dynlex
import ui/shader_attachments.dl

set samples to a UI shader frame image named "samples" storing "rgba16float" with 4 samples
set output to a UI shader frame image named "output" storing "rgba16float"
set target to a UI shader image view of "samples" at level 0 layer 0
set resolve to a UI shader image view of "output" at level 0 layer 0
set color to a UI shader color attachment using target resolving into resolve loading "clear" storing "discard" cleared to [0.0,0.0,0.0,1.0]
set state to a UI shader raster state culling "back" facing "ccw" writing depth true comparing "less" blending "opaque"

free samples
free output
free color
free state
```

Constructing these descriptions creates no GPU objects. Container construction
transfers ownership of supplied JSON children, including the target and resolve
views above. Color clears preserve finite HDR values rather than clamping them
to display colors; depth clears lie between zero and one.

The browser asset bank owns the corresponding image/sampler storage. It allocates
fixed images once, replaces frame-sized images on resize and retires each handle
once. Uploads name a complete mip level and cube face. Color uploads use raw RGBA
bytes or IEEE half-float components; depth images are written by render passes.
Image definitions remain immutable and can be inspected before frame storage is
allocated. The current program adapter still uses its single output/depth target;
connecting these descriptions and asset storage to its pass graph is in progress.

## Verification

`tests/shared/shader_api` verifies the DynLex operation table and six-word ABI at
both optimization levels. `node tests/browser/shader_streams.mjs` checks allocation
reuse, ownership and range validation. `node tests/browser/shader_services.mjs`
checks source loading and the browser ABI. Browser rendering tests compare actual
pixels on WebGPU and WebGL2, covering interleaved attributes, signed and unsigned
inputs, instance records, offsets, live updates, shrinking, indexed and nonindexed
draws, and draw-local builtin IDs.

`tests/shared/shader_values` checks owned packing and matrix conversion on native
and Wasm. Browser range tests exercise narrowing and non-finite inputs. The
browser runner also compiles all 21 input shapes with the selected browser
compiler, then compares actual WebGPU and WebGL2 pixels. Fourteen signed and
unsigned arithmetic cases also verify conversions, division, remainders, shifts
and extrema through both shader backends. Its direct invocation
is `node tests/browser/run.mjs <application directory> <graphics mode> <compiler checkout>`;
`scripts/test.py --browser --dynlex <compiler checkout>` supplies that argument.

`tests/shared/shader_resources` and `tests/shared/shader_attachments` check the
description data at O0/O2. `tests/browser/shader_resource_descriptions.mjs` also
checks native-emitted Wasm and the shipped browser compiler, including zero
retained allocations. `shader_assets.mjs` verifies resource ownership and resize
failure cleanup. `prepare_resources.mjs` and `shader_resources_browser.mjs` compile
actual DynLex shaders/descriptions and compare WebGPU/WebGL pixels for separate
samplers, cube faces/mips, sRGB/HDR and filtered shadow comparisons on private Xvfb.
