#!/usr/bin/env python3
"""Export a deterministic UI SDK for browser builds and virtual source workspaces."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from application_notices import compiler_notices


def revision(directory):
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=directory, text=True).strip()


def export_sdk(project, compiler, output):
    sources = {'LICENSE.md': (project / 'LICENSE.md').read_bytes()}
    sources.update({f'licenses/{name}': data for name, data in compiler_notices(compiler).items()})
    for directory in ['ui', 'platform', 'assets', 'testing', 'tools']:
        for path in sorted((project / directory).rglob('*')):
            if path.is_file():
                sources[path.relative_to(project).as_posix()] = path.read_bytes()
    sources['platform/browser/graphics-backend.js'] = (compiler / 'web/graphics-backend.js').read_bytes()
    runtime = compiler / 'src/web/ide/public/compiler'
    for path in sorted({runtime / 'runtimeImports.js', *runtime.glob('runtime*.js')}):
        sources[f'platform/browser/runtime/{path.name}'] = path.read_bytes()
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(sources.items())}
    manifest = {'schema': 1, 'package': 'dynlex-ui',
                'sourceRevision': revision(project), 'runtimeRevision': revision(compiler),
                'contentHash': hashlib.sha256(json.dumps(digests, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                'files': digests}
    sources['sdk.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name, data in sorted(sources.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(entry, data)
    temporary.replace(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    manifest = export_sdk(project, args.dynlex.resolve(), args.output.resolve())
    print(f"Exported {len(manifest['files'])} SDK files: {args.output.resolve()}")


if __name__ == '__main__':
    main()
