"""The SDK carries every runtime module supplied by its compiler checkout."""
from pathlib import Path
import sys
import json
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import export_sdk


class RuntimeModules(unittest.TestCase):
    def compiler_notices(self, compiler):
        (compiler / 'metadata').mkdir(parents=True)
        (compiler / 'metadata/library-notices.json').write_text(json.dumps({'custom.txt': 'notice.txt'}))
        (compiler / 'notice.txt').write_text('Compiler library notice\n')

    def test_export_requires_the_runtime_entrypoint(self):
        with tempfile.TemporaryDirectory() as directory:
            compiler = Path(directory) / 'compiler'
            self.compiler_notices(compiler)
            (compiler / 'web').mkdir(parents=True)
            (compiler / 'web/graphics-backend.js').write_text('// Graphics adapter\n')
            with patch.object(export_sdk, 'revision', return_value='test-revision'):
                with self.assertRaises(FileNotFoundError):
                    export_sdk.export_sdk(ROOT, compiler, Path(directory) / 'sdk.zip')

    def test_export_includes_additional_runtime_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            compiler = Path(directory) / 'compiler'
            self.compiler_notices(compiler)
            runtime = compiler / 'src/web/ide/public/compiler'
            runtime.mkdir(parents=True)
            names = ['runtimeImports.js', 'runtimeFilesystem.js', 'runtimeHost.js',
                     'runtimeLayout.js', 'runtimeAdditional.js']
            for name in names:
                (runtime / name).write_text(f'// {name}\n')
            (runtime / 'dynlex_web.js').write_text('// Compiler, separate from the UI runtime.\n')
            (compiler / 'web').mkdir()
            (compiler / 'web/graphics-backend.js').write_text('// Graphics adapter\n')
            output = Path(directory) / 'sdk.zip'
            with patch.object(export_sdk, 'revision', return_value='test-revision'):
                manifest = export_sdk.export_sdk(ROOT, compiler, output)
            prefix = 'platform/browser/runtime/'
            self.assertEqual({name.removeprefix(prefix) for name in manifest['files'] if name.startswith(prefix)}, set(names))
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('licenses/custom.txt'), b'Compiler library notice\n')
                for name in names:
                    self.assertEqual(archive.read(prefix + name), (runtime / name).read_bytes())


if __name__ == '__main__':
    unittest.main()
