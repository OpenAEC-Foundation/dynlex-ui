# Scene geometry, cameras and picking

`ui/scene_camera.dl` shares camera transforms, label projection and picking rays.
It uses the core vector library and its column-major, float32 graphics matrices.
World Y points upward; viewport coordinates start at the top left and clip depth
runs from zero at the near plane to one at the far plane.

```dynlex
import ui/scene_camera.dl

set eye to a new vector with x 12.0, y 18.0 and z 15.0
set target to a new vector with x 0.0, y 0.4 and z 0.0
set camera to a UI scene camera at eye aimed at target with angle 35.0 aspect 1.0 near 0.1 far 150.0
set viewport to UI box at 0.0 0.0 sized 800.0 600.0
set camera's aspect to viewport's width / viewport's height

set matrix to the UI scene view projection for camera
set label to the UI scene projection for target through camera in viewport
set ray to the UI scene ray at (a UI point at 400.0 and 300.0) through camera in viewport
set hit to the UI scene hit from ray on ground at 0.0
```

Update the camera's aspect when its viewport changes. `matrix` contains sixteen
column-major float32 values for shader submission. A projection exposes `screen`,
`depth` and `visible`; clipped points have `visible` set to false. Camera rays
have normalized directions. Ground intersections expose `point`, `distance` in
world units and `hit`; parallel rays and intersections behind the ray report no
hit. A ray supplied by application code can use a non-unit direction.
Camera construction and point projection accept core vectors with integer,
float32 or float64 components. Camera state stores float64 vectors; use
`the UI scene vector form of value` when assigning a vector directly to that state.

Camera position and target must differ. The up direction must be finite and
nonparallel to the view; the field of view, aspect ratio and clip planes follow
the core graphics projection contract. Invalid camera geometry fails explicitly.

`ui/scene_picking.dl` adds triangle intersections for entity selection and
occlusion checks. Supply the same transformed world vertices used for rendering:

```dynlex
set hit to the UI scene hit from ray on triangle first second third including backfaces false
```

The result uses the same point, world-unit distance and hit flag as ground picks.
Triangle winding selects the front face. Enable backfaces for two-sided geometry.
Parallel rays, degenerate triangles and intersections behind the ray report no
hit. Integer and floating-point vertex coordinates share the camera conversion.

## Indexed meshes

`ui/scene_mesh.dl` defines owning, immutable `UI scene mesh` values. Each mesh has
`vertices` and `indices` sequences. Copies share storage; replacing or releasing a
copy does not invalidate other copies. Empty meshes are valid values. Builders
use ordinary mutable lists and transfer their items into the completed mesh.

A `UI mesh vertex` stores eight float32 components in this order: `x`, `y`, `z`,
`nx`, `ny`, `nz`, `u`, `v`. Its 32-byte interleaved layout supplies position at
byte 0, normal at byte 12 and UV at byte 24. Indices are uint32 triangle lists.
The geometry is independent of materials, scene instances and GPU resources.
Every mesh also owns a `colors` sequence with one `linear UI paint` per vertex.
That separate twelve-byte RGB stream uses linear float32 components; untinted
primitives contain explicit white colors. Its vertex-buffer layout is stride 12,
with one `float32x3` attribute at byte 0. Vertex colors multiply the material color.

```dynlex
import ui/scene_surfaces.dl
import ui/scene_round_meshes.dl
import ui/scene_solids.dl

set floor to a UI plane mesh with 1 by 1 segments
set tile to a UI box mesh with 1 by 1 by 1 segments
set water to a UI box mesh with 5 by 1 by 5 segments
set head to a UI sphere mesh with 16 slices and 12 stacks
set trunk to a UI cylinder mesh with top 0.1 bottom 0.16 height 0.19 around 9 sides capped true
set crown to a UI cylinder mesh with top 0.0 bottom 1.0 height 1.0 around 10 sides capped true
set handle to a UI torus mesh with radius 0.095 tube 0.01 around 12 slices and 4 sides swept through 180.0 degrees
set selection to a UI ring mesh with inner 0.34 outer 0.42 around 32 sides
set rock to a UI icosahedron mesh
set gable to a UI convex prism mesh from [(a UI point at -0.43 and 0.0), (a UI point at 0.43 and 0.0), (a UI point at 0.0 and 0.37)] with depth 0.76
```

Planes occupy a unit square in XY and face positive Z. Boxes have unit dimensions
and independent normals and texture seams on every face. Spheres have unit radius
and start their longitude seam at negative X; their poles omit degenerate
triangles. Cylinder axes follow Y; the height is
centered at zero, top and bottom radii can differ, and either radius can be zero
for a cone. Caps have independent normals. Tori lie in XY and start at positive
X; a partial arc remains open. Rings lie in XY and face positive Z. Icosahedra
have unit circumradius and flat normals. Convex prism caps follow the supplied
polygon in XY at Z=0 and Z=depth; either polygon winding produces outward faces.
Prism outlines must be simple and strictly convex, with no repeated or collinear
corners. Generated UVs run from zero to one.

Subdivision counts, radii, depths and arcs must describe valid surfaces. Invalid
domains, non-finite or unrepresentable float32 components, incomplete triangles
and references beyond the vertex sequence fail explicitly. These primitives
provide scene data; material lighting and scene submission are separate APIs.

## Model transforms and mesh picking

`ui/scene_transforms.dl` prepares an affine graphics matrix once, storing its
float32 inverse and handedness. Build model matrices with the existing core
translation, rotation, scale and product operations. The transform accepts
nonuniform scale, shear and mirroring. Singular, projective and non-finite model
matrices fail explicitly. Inverse components must fit in float32.

```dynlex
import ui/scene_mesh_picking.dl

set scale to a graphics scale by x 0.4 y 0.7 z 0.3
set translation to a graphics translation by x 2.0 y 0.7 z 3.0
set transform to a UI scene transform from (the graphics product of translation and scale)
set local to a new vector with x 0.0, y 1.0 and z 0.0
set {local normal} to a new vector with x 0.0, y 1.0 and z 0.0
set point to the UI scene position of local through transform
set normal to the UI scene normal of local normal through transform
set hit to the UI scene hit from ray on mesh head through transform including backfaces false
```

Point transforms include translation; `the UI scene direction of value through
transform` excludes it. `the UI scene position of point restored through
transform` applies the inverse. Normal transforms apply the inverse transpose
and normalize the result, preserving lighting under nonuniform scales and shear.
Normals must be finite and nonzero. All vector inputs accept integer, float32 or
float64 components and return float64 scene vectors.

Meshes cache local bounds at construction. Mesh picking transforms the ray into
local space, rejects missed bounds, finds the nearest triangle and returns its
world-space point and distance. It uses the mesh's original outward-facing side
under mirroring; a renderer culling faces must adjust its front-face convention
when the transform's `handedness` is negative. Empty meshes and missed triangles
report `hit = false`. The local ray retains its magnitude so nonuniform scales
and non-unit input directions do not change which intersection is nearest.

## Articulated models

`ui/scene_models.dl` defines model prototypes as immutable sequences of parts.
A part carries a name, parent index, mesh, material, local pose, visibility,
pickability and shadow flags. Groups carry an empty mesh. Every parent precedes
its children; -1 identifies a root. Multiple roots are allowed. Named lookups
are scoped to a parent and fail on missing or ambiguous matches.

Local `UI scene pose` data contains float64 `position`, `rotation` and `scale`
vectors. Rotations are XYZ Euler angles in radians. Matrices use the existing
column-major graphics convention. Pose construction accepts integer, float32 or
float64 vectors; `a UI scene vector from [x,y,z]` provides a compact array form.
Components must be finite and scales nonzero. Model creation also checks that
the resulting matrix and inverse fit the shared float32 transform format.

`UI scene material` stores sRGB `color` and `emission` paints, `emission strength`,
`roughness`, `metalness`, `opacity`, `unlit`, `double sided`, `depth write` and an
application-defined uint32 `flags` value. Colors use channels from zero through
255. Roughness, metalness and opacity range from zero through one; emission
strength is a finite nonnegative float32 value. The material constructor starts
opaque with depth writes enabled and no emission. `UI ink from RGB value` accepts
a packed twenty-four-bit integer without narrowing wider operands first.

```dynlex
import ui/scene_instance_picking.dl
import ui/scene_surfaces.dl

set mesh to a UI box mesh with 1 by 1 by 1 segments
set material to a UI scene material with color (UI ink 199 122 67) roughness 0.78 metalness 0.0
set pose to an identity UI scene pose
set parts to [
    a UI scene group named "actor" under -1 at pose,
    a UI scene mesh part named "arm" under 0 using mesh with material material at pose
]
set model to a UI scene model from parts
set actor to a UI scene instance of model
set arm to the index of UI scene part named "arm" under 0 in model

set pose's rotation to a UI scene vector from [0.4,0.0,0.0]
set UI scene pose of part arm in actor to pose
set placement to the UI scene placement of part arm in actor
set UI scene visibility of part arm in actor to false
refresh UI scene instance actor
close UI scene instance actor
```

`ui/scene_instances.dl` creates separate mutable articulation, material and flag
lists for each instance while retaining the prototype's immutable mesh data.
The factory returns an owning pointer; close each instance exactly once. Copies
of that pointer refer to the same instance. Separate factory calls are independent.
The prototype can leave its caller's scope while instances still retain it.

Setters compare against current values and invalidate changed branches. Refresh
propagates changes to descendants in parent order, updates only affected world
placements and derives visible world bounds. Unchanged refreshes do no work.
The instance and each placement expose a `revision` for resource updates.
Visibility and pickability propagate through parents. Material overrides never
modify the prototype. `set UI scene root pose in actor to pose` moves every root
and its descendants together.

Instance `extent` contains `bounds` and `present`; an empty or entirely hidden
model has no extent. `ui/scene_instance_picking.dl` first rejects missed instance
bounds, then picks its nearest visible, pickable mesh. `the UI scene selection
from ray in actor including backfaces false` returns `part` and `hit`. A miss has
part -1 and `hit` with its hit flag false. These model and instance APIs prepare
scene data; they do not replace material shaders or GPU scene submission.

## Baking and smooth normals

`ui/scene_baking.dl` merges reusable meshes into one indexed mesh. It transforms
positions and inverse-transpose normals, multiplies source vertex colors by a
linear tint and adjusts winding when the transform mirrors the geometry.
The completed mesh owns its data independently of all sources.

```dynlex
import ui/scene_baking.dl
import ui/scene_surfaces.dl

set source to a UI box mesh with 1 by 1 by 1 segments
set batch to a UI mesh builder
set transform to a UI scene transform from (an identity graphics matrix)
append UI mesh source through transform tinted (linear UI ink from (UI ink 199 122 67)) to batch
set combined to a completed UI mesh from batch
```

Completing a builder consumes and closes it. Use `close UI mesh builder batch`
to discard an unfinished builder. The colored mesh constructor requires
exactly one finite RGB value per vertex; incomplete colors and invalid triangle
indices fail explicitly. `ui/colors.dl` shares the linear RGB type and sRGB
conversion with ordinary UI painting. `linear UI ink from color` decodes an
eight-bit sRGB paint once. `linear UI ink red r green g blue b` accepts finite
float32 linear components directly.

`ui/scene_normals.dl` supplies `recalculate UI mesh normals in vertices using
indices` for mutable vertex/index builders. It accumulates area-weighted face
normals in float32 storage, then normalizes each vertex. Unused vertices and
vertices incident only to degenerate faces retain zero normals. Those are valid
mesh data and survive baking. The raw inverse-transpose operation is available
as `the UI scene normal vector of value through transform`.

## Quaternion orientations

`ui/scene_rotations.dl` reuses core quaternions for geometry aligned between
directions. `the UI scene rotation from direction first to direction second`
normalizes finite nonzero inputs and chooses a perpendicular half-turn axis for
opposite directions. `a UI scene matrix at position oriented rotation scaled
scale` composes the resulting orientation with translation and nonuniform scale.
Quaternion inputs must have a finite nonzero magnitude.
