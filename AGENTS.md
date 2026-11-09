# DynLex UI development

Implement layout, declarative descriptions, interaction, selection and geometry in
DynLex under `ui/`. Keep host APIs behind `UI driver` operations. `platform/native`
uses DynLex's graphics/font libraries; `platform/browser` supplies WebGPU/WebGL2, font/SVG
rasterization, surface lifetime and normalized input. Do not add compiler UI syntax,
HTML controls, CSS layout for application UI, or a second interaction implementation.

Keep code files below 1000 lines. Keep errors explicit, fix root causes, and remove
obsolete paths instead of adding compatibility fallbacks. The user authorizes fixing
compiler bugs autonomously and requests a final summary of them. Reproduce compiler
bugs without library imports and debug them using the compiler's `scripts/debug.sh`.

Work in a repository-local worktree created by `scripts/create-worktree.sh`.
Do not use subagents unless the user requests them. Never open test windows on the
user's desktop: use private Xvfb and unset WAYLAND_DISPLAY and WAYLAND_SOCKET.
Use a separate Chrome profile on the private display for browser visual tests.

Build: `python3 scripts/build.py ribbon --dynlex <compiler-checkout>`; add
`--target native` for desktop. Tests: `python3 scripts/test.py --dynlex
<compiler-checkout> --native --browser`. Shared tests require a built compiler;
native tests additionally require its graphics/font dependencies, X11 and Xvfb;
browser visual tests require Node 22+, Chrome and Xvfb. Limit CMake builds to one
job on this machine. Keep test drivers outside application sources.
