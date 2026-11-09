#!/usr/bin/env python3
"""Compile a DynLex UI application for desktop or a self-contained browser directory."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("example", choices=["ribbon", "snake", "text"])
    parser.add_argument("--dynlex", type=Path, required=True, help="DynLex source checkout containing build/dynlex")
    parser.add_argument("--target", choices=["browser", "native"], default="browser")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    dynlex = args.dynlex.resolve()
    compiler = dynlex / "build/dynlex"
    if not compiler.is_file():
        parser.error(f"Build the compiler first: {compiler}")
    if args.target == "native":
        output = (args.output or project / "build" / f"{args.example}.out").resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(compiler), f"examples/{args.example}/main.dl", "-o", str(output)], cwd=project, check=True)
        print(output)
        return
    output = (args.output or project / "dist" / args.example).resolve()
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(compiler), f"examples/{args.example}/browser.dl", "--emit-wasm", "-o", str(output / "application.wasm")], cwd=project, check=True)
    shutil.copy2(project / "LICENSE.md", output / "LICENSE.md")
    licenses = output / "licenses"
    licenses.mkdir(exist_ok=True)
    shutil.copy2(project / "assets/icons/LICENSE", licenses / "icons.txt")
    platform = output / "platform"
    platform.mkdir(exist_ok=True)
    source = project / "platform/browser"
    for path in source.glob("*.js"):
        shutil.copy2(path, platform / path.name)
    shutil.copy2(dynlex / "web/graphics-backend.js", platform / "graphics-backend.js")
    shutil.copy2(source / "index.html", output / "index.html")
    runtime = platform / "runtime"
    runtime.mkdir(exist_ok=True)
    for name in ["runtimeImports.js", "runtimeFilesystem.js", "runtimeHost.js", "runtimeLayout.js"]:
        shutil.copy2(dynlex / "src/web/ide/public/compiler" / name, runtime / name)
    shutil.copytree(project / "assets/fonts", output / "assets/fonts", dirs_exist_ok=True)
    fonts = sorted(path.relative_to(output).as_posix() for path in (output / "assets/fonts").glob("*.ttf"))
    (output / "application.json").write_text(json.dumps({"module": "application.wasm", "fonts": fonts}, indent=2) + "\n")
    print(f"Built {output}; serve it with python3 -m http.server --directory {output}")


if __name__ == "__main__":
    main()
