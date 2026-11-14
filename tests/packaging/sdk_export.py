import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


PROJECT = Path(__file__).resolve().parents[2]
COMPILER = Path(sys.argv.pop(1)).resolve()


class ExportTests(unittest.TestCase):
    def test_package_is_complete_and_reproducible(self):
        with tempfile.TemporaryDirectory(prefix='dynlex-sdk-export-') as temporary:
            outputs = [Path(temporary) / f'sdk-{index}.zip' for index in range(2)]
            for output in outputs:
                subprocess.run([sys.executable, str(PROJECT / 'scripts/export_sdk.py'),
                                '--dynlex', str(COMPILER), '--output', str(output)], check=True)
            self.assertEqual(outputs[0].read_bytes(), outputs[1].read_bytes())
            with zipfile.ZipFile(outputs[0]) as package:
                manifest = json.loads(package.read('sdk.json'))
                self.assertEqual(manifest['schema'], 1)
                self.assertEqual(manifest['package'], 'dynlex-ui')
                self.assertEqual(set(package.namelist()), set(manifest['files']) | {'sdk.json'})
                self.assertIn('ui/browser.dl', manifest['files'])
                self.assertIn('ui/native.dl', manifest['files'])
                self.assertIn('platform/browser/gpu-webgl.js', manifest['files'])
                self.assertIn('platform/browser/gpu-webgpu.js', manifest['files'])
                self.assertIn('platform/browser/graphics-backend.js', manifest['files'])
                self.assertIn('platform/browser/runtime/runtimeImports.js', manifest['files'])
                self.assertIn('assets/fonts/LICENSE-NotoFonts', manifest['files'])
                self.assertIn('LICENSE.md', manifest['files'])
                for name, digest in manifest['files'].items():
                    self.assertNotIn('..', Path(name).parts)
                    self.assertFalse(name.startswith(('tests/', 'examples/')))
                    self.assertFalse(name.endswith(('.wasm', '.out')))
                    self.assertEqual(hashlib.sha256(package.read(name)).hexdigest(), digest)
                self.assertEqual(package.read('ui/browser.dl'), (PROJECT / 'ui/browser.dl').read_bytes())
                self.assertEqual(package.read('testing/driver.dl'), (PROJECT / 'testing/driver.dl').read_bytes())
                self.assertEqual(package.read('platform/browser/graphics-backend.js'),
                                 (COMPILER / 'web/graphics-backend.js').read_bytes())


unittest.main()
