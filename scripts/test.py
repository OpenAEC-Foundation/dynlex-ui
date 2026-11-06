#!/usr/bin/env python3
"""Verify shared UI logic at both optimization levels; optional isolated platform checks."""
import argparse
from pathlib import Path
import os
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--browser', action='store_true')
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    compiler = args.dynlex.resolve() / 'build/dynlex'
    if not compiler.is_file():
        parser.error(f'Build the compiler first: {compiler}')
    subprocess.run(["python3", "scripts/test_external_imports.py", "--dynlex", str(args.dynlex.resolve())], cwd=project, check=True)
    count = 0
    with tempfile.TemporaryDirectory(prefix='dynlex-ui-tests-') as temporary:
        for source in sorted(project.glob('tests/*/*/main.dl')):
            expected = source.with_name('expected.txt').read_text()
            for optimization in ['-O0', '-O2']:
                output = Path(temporary) / 'case.out'
                result = subprocess.run([str(compiler), str(source), optimization, '-o', str(output)],
                                        cwd=project, text=True, capture_output=True, timeout=60)
                if result.returncode or result.stderr:
                    raise RuntimeError(f'{source}: {result.stdout}{result.stderr}')
                result = subprocess.run([str(output)], cwd=project, text=True, capture_output=True, timeout=30)
                if result.returncode or result.stderr or result.stdout != expected:
                    raise RuntimeError(f'{source}: exit={result.returncode}; output={result.stdout!r}; errors={result.stderr!r}; expected={expected!r}')
                count += 1
            print(f'PASS {source.parent.relative_to(project)}', flush=True)
    subprocess.run(['python3', 'scripts/test_ui_svg.py'], cwd=project, check=True)
    print(f'{count} shared UI cases passed.', flush=True)
    if args.native:
        for name in ['sections', 'ribbon', 'snake', 'text']:
            subprocess.run(['python3', f'scripts/test_{"ui_sections" if name == "sections" else name + "_ui"}.py',
                            str(project), str(compiler)], cwd=project, check=True)
        subprocess.run(["python3", "scripts/test_application_lifetime.py", "--dynlex", str(args.dynlex.resolve())], cwd=project, check=True)
    if args.browser:
        for name in ['ribbon', 'snake', 'text']:
            subprocess.run(['python3', 'scripts/build.py', name, '--dynlex', str(args.dynlex.resolve())], cwd=project, check=True)
            xvfb = shutil.which('xvfb-run')
            if not xvfb:
                parser.error('Browser visual tests require xvfb-run')
            environment = dict(os.environ, DYNLEX_BACKGROUND_BROWSER='1', XDG_SESSION_TYPE='x11')
            environment.pop('WAYLAND_DISPLAY', None)
            environment.pop('WAYLAND_SOCKET', None)
            subprocess.run([xvfb, '-a', '-s', '-screen 0 1400x1000x24', 'node', 'tests/browser/run.mjs', f'dist/{name}'], cwd=project, env=environment, check=True)


if __name__ == '__main__':
    main()
