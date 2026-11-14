#!/usr/bin/env python3
"""Public palette data rejects empty names, duplicate names and missing references."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    compiler = args.dynlex.resolve() / 'build/dynlex'
    if os.name == 'posix':
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    cases = {
        'duplicate': 'Palette color names must be unique\n',
        'empty': 'Palette colors need nonempty names\n',
        'reference': 'Palette color references need nonempty names\n',
        'missing': 'An appearance names an undefined palette color\n',
    }
    with tempfile.TemporaryDirectory(prefix='dynlex-ui-palette-errors-') as temporary:
        for name, expected in cases.items():
            output = Path(temporary) / 'invalid.out'
            subprocess.run([str(compiler), f'tests/shared/palettes/invalid_{name}.dl',
                            '-O0', '-o', str(output)], cwd=root, check=True, timeout=60)
            result = subprocess.run([str(output)], cwd=root, capture_output=True,
                                    text=True, timeout=10)
            assert result.returncode != 0, name
            assert result.stdout == expected, (name, result.stdout)
            assert result.stderr == '', (name, result.stderr)
            print(f'PASS palette rejects {name}', flush=True)


if __name__ == '__main__':
    main()
