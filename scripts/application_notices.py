"""Carry the notices of the UI assets and its compiler-supplied libraries."""
import json


def compiler_notices(compiler):
    manifest = json.loads((compiler / 'metadata/library-notices.json').read_text())
    return {name: (compiler / source).read_bytes() for name, source in manifest.items()}


def write_notices(project, compiler, destination):
    notices = {'ui.txt': (project / 'LICENSE.md').read_bytes(),
               'icons.txt': (project / 'assets/icons/LICENSE').read_bytes()}
    for source in (project / 'assets/fonts').glob('LICENSE*'):
        notices[source.name + '.txt'] = source.read_bytes()
    for source in (project / 'assets/licenses').glob('*'):
        notices[source.name] = source.read_bytes()
    notices.update(compiler_notices(compiler))
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in notices.items():
        (destination / name).write_bytes(data)
