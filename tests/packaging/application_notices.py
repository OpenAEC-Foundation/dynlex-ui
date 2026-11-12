"""Application artifacts retain the UI, asset and declared library notices."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from application_notices import write_notices


class ApplicationNotices(unittest.TestCase):
    def test_notice_bytes_follow_the_compiler_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project, compiler = root / 'ui', root / 'compiler'
            (project / 'assets/icons').mkdir(parents=True)
            (project / 'assets/fonts').mkdir()
            (project / 'LICENSE.md').write_bytes(b'UI notice\n')
            (project / 'assets/icons/LICENSE').write_bytes(b'Icon notice\n')
            (project / 'assets/fonts/LICENSE-Font').write_bytes(b'Font notice\n')
            (compiler / 'metadata').mkdir(parents=True)
            (compiler / 'metadata/library-notices.json').write_text(json.dumps({'unicode.txt': 'data/notice'}))
            (compiler / 'data').mkdir()
            (compiler / 'data/notice').write_bytes(b'Unicode notice\n')
            (root / 'LICENSE.md').write_bytes(b'Caller-owned notice\n')
            destination = root / 'application.out.licenses'
            write_notices(project, compiler, destination)
            expected = {'ui.txt': b'UI notice\n', 'icons.txt': b'Icon notice\n',
                        'LICENSE-Font.txt': b'Font notice\n', 'unicode.txt': b'Unicode notice\n'}
            self.assertEqual({file.name: file.read_bytes() for file in destination.iterdir()}, expected)
            self.assertEqual((root / 'LICENSE.md').read_bytes(), b'Caller-owned notice\n')


if __name__ == '__main__':
    unittest.main()
