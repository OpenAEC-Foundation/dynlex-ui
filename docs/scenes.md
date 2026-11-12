# Scene cameras and picking

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

Camera position and target must differ. The up direction must be finite and
nonparallel to the view; the field of view, aspect ratio and clip planes follow
the core graphics projection contract. Invalid camera geometry fails explicitly.
