#!/usr/bin/env python3
"""Compile a DynLex UI application for desktop or a self-contained browser directory."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
from application_notices import write_notices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("example", nargs="?", choices=["ribbon", "snake", "text"])
    parser.add_argument("--entry", type=Path, help="Build a custom DynLex UI application instead of an example")
    parser.add_argument("--dynlex", type=Path, required=True, help="DynLex source checkout containing build/dynlex")
    parser.add_argument("--target", choices=["browser", "native"], default="browser")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if bool(args.example) == bool(args.entry):
        parser.error("Choose an example or --entry")
    project = Path(__file__).resolve().parents[1]
    dynlex = args.dynlex.resolve()
    compiler = dynlex / "build/dynlex"
    if not compiler.is_file():
        parser.error(f"Build the compiler first: {compiler}")
    name = args.example or args.entry.stem
    source = args.entry.resolve() if args.entry else project / "examples" / args.example / ("main.dl" if args.target == "native" else "browser.dl")
    if not source.is_file():
        parser.error(f"The application source does not exist: {source}")
    if args.target == "native":
        output = (args.output or project / "build" / f"{name}.out").resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(compiler), str(source), "-o", str(output)], cwd=project, check=True)
        write_notices(project, dynlex, output.with_name(output.name + '.licenses'))
        print(output)
        return
    output = (args.output or project / "dist" / name).resolve()
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(compiler), str(source), "--emit-wasm", "-o", str(output / "application.wasm")], cwd=project, check=True)
    shutil.copy2(project / "LICENSE.md", output / "LICENSE.md")
    write_notices(project, dynlex, output / "licenses")
    platform = output / "platform"
    platform.mkdir(exist_ok=True)
    source = project / "platform/browser"
    for path in source.glob("*.js"):
        shutil.copy2(path, platform / path.name)
    shutil.copy2(dynlex / "web/graphics-backend.js", platform / "graphics-backend.js")
    shutil.copy2(source / "index.html", output / "index.html")
    runtime = platform / "runtime"
    runtime.mkdir(exist_ok=True)
    supplied = dynlex / "src/web/ide/public/compiler"
    for path in sorted({supplied / "runtimeImports.js", *supplied.glob("runtime*.js")}):
        shutil.copy2(path, runtime / path.name)
    shutil.copytree(project / "assets/fonts", output / "assets/fonts", dirs_exist_ok=True)
    fonts = sorted(path.relative_to(output).as_posix() for path in (output / "assets/fonts").glob("*.ttf"))
    (output / "application.json").write_text(json.dumps({"module": "application.wasm", "fonts": fonts}, indent=2) + "\n")
    print(f"Built {output}; serve it with python3 -m http.server --directory {output}")


if __name__ == "__main__":
    main()
