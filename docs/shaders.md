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
set image to a UI texture from shader resource sized width by height using values in view
```

`the JSON form of UI shader draw draw` produces the equivalent program-description
object. A pass includes a `draws` array, which may initially be empty while DynLex
prepares its buffers. Zero-count draws produce no primitives. Nonempty draws must
fit every bound vertex and instance stream and the requested index range.

## Verification

`tests/shared/shader_api` verifies the DynLex operation table and six-word ABI at
both optimization levels. `node tests/browser/shader_streams.mjs` checks allocation
reuse, ownership and range validation. `node tests/browser/shader_services.mjs`
checks source loading and the browser ABI. Browser rendering tests compare actual
pixels on WebGPU and WebGL2, covering interleaved attributes, signed and unsigned
inputs, instance records, offsets, live updates, shrinking, indexed and nonindexed
draws, and draw-local builtin IDs.
