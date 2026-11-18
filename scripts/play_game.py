#!/usr/bin/env python3
"""Build and launch the native game and graphics studies from the UI package."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class Game:
    source: str
    window: str
    width: int = 1280
    height: int = 780
    shaders: bool = False


GAMES = {
    "snake": Game("../snake/main.dl", "snake studio", 1120, 760),
    "breakout": Game("lexi8/main.dl", "lexi arcade", 1200, 780),
    "geometry": Game("geometry_dash/main.dl", "geometry dash"),
    "shaders": Game("shader_gallery.dl", "shader atelier", shaders=True),
    "mandelbrot": Game("mandelbrot.dl", "shader atelier", shaders=True),
    "plasma": Game("plasma.dl", "shader atelier", shaders=True),
    "event-horizon": Game("event_horizon/main.dl", "shader atelier", shaders=True),
    "cube": Game("basic_cube.dl", "spatial studio"),
    "city": Game("city_flyover.dl", "spatial studio"),
    "typography": Game("text_test.dl", "typography studio", 800, 640),
}


def build_game(project: Path, name: str, dynlex: Path) -> Path:
    game = GAMES[name]
    compiler = dynlex / "build" / ("dynlex.exe" if os.name == "nt" else "dynlex")
    if not compiler.is_file():
        raise RuntimeError("Build the selected DynLex checkout first with its scripts/build.sh")
    output = project / "build/games"
    output.mkdir(parents=True, exist_ok=True)

    def compile(source, destination, *options):
        result = subprocess.run(
            [str(compiler), str(project / source), *options, "-o", str(destination)],
            cwd=dynlex, capture_output=True, text=True, timeout=180,
        )
        if result.returncode or result.stdout or result.stderr:
            raise RuntimeError(f"{source} must compile without diagnostics:\n{result.stdout}{result.stderr}")

    if game.shaders:
        shaders = output / "shaders"
        shaders.mkdir(exist_ok=True)
        compile("examples/games/passthrough_vertex.dl", shaders / "vertex.spv", "--emit-spirv", "--shader-stage=vertex")
        for study in ("mandelbrot", "plasma", "julia", "rings"):
            compile(f"examples/games/{study}_shader.dl", shaders / f"{study}.spv", "--emit-spirv", "--shader-stage=fragment")
        compile("examples/games/event_horizon/horizon.dl", shaders / "horizon.spv", "--emit-spirv", "--shader-stage=fragment")
    executable = output / f"{name}.out"
    compile(f"examples/games/{game.source}", executable, "-O2")
    return executable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", choices=GAMES)
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--dynlex", type=Path, required=True, help="DynLex checkout containing build/dynlex")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    executable = build_game(project, args.game, args.dynlex.resolve())
    if args.build_only:
        print(executable)
    else:
        raise SystemExit(subprocess.run([str(executable)], cwd=project).returncode)


if __name__ == "__main__":
    main()
