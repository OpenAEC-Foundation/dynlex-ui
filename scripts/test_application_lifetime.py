#!/usr/bin/env python3
"""Build real desktop entry points and close their owned state on a private display."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import time
from native_ui_test import close_window, named_window, private_display_environment, x11_library


EXAMPLES = [('ribbon', b'ribbon studio'), ('snake', b'snake studio'), ('text', b'writing room')]


def drive(project):
    x = x11_library()
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('The private X display is unavailable')
    try:
        root = x.XDefaultRootWindow(display)
        for example, title in EXAMPLES:
            app = subprocess.Popen([str(project / 'build' / f'{example}.out')], cwd=project,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                window = None
                deadline = time.monotonic() + 10
                while window is None and time.monotonic() < deadline:
                    if app.poll() is not None:
                        raise RuntimeError(f'{example} exited before opening: {app.communicate()}')
                    window = named_window(x, display, root, title)
                    time.sleep(0.1)
                if window is None:
                    raise RuntimeError(f'{example} did not open')
                time.sleep(0.2)
                close_window(x, display, window)
                output, errors = app.communicate(timeout=10)
                if app.returncode or output or errors:
                    raise RuntimeError(f'{example} did not close cleanly: {app.returncode}, {output!r}, {errors!r}')
                print(f'{example}: production state and native resources closed cleanly', flush=True)
            finally:
                if app.poll() is None:
                    app.terminate()
                    app.wait(timeout=5)
    finally:
        x.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    parser.add_argument('--drive', action='store_true')
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    if args.drive:
        drive(project)
        return
    xvfb = shutil.which('xvfb-run')
    if not xvfb:
        parser.error('Native lifetime tests require xvfb-run')
    for example, title in EXAMPLES:
        subprocess.run([sys.executable, 'scripts/build.py', example, '--dynlex', str(args.dynlex.resolve()), '--target', 'native'], cwd=project, check=True)
    subprocess.run([xvfb, '-a', '-s', '-screen 0 1400x1000x24', sys.executable, str(Path(__file__).resolve()),
                    '--dynlex', str(args.dynlex.resolve()), '--drive'], cwd=project,
                   env=private_display_environment(), check=True, timeout=60)


if __name__ == '__main__':
    main()
