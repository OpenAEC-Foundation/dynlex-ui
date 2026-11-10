#!/usr/bin/env python3
"""Render source-bound marks with native fonts on a private X display."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from native_ui_test import close_window, named_window, private_display_environment, save_png, screenshot, x11_library


def drive(project, executable):
    x = x11_library()
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('The private X display is unavailable')
    app = subprocess.Popen([str(executable)], cwd=project, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    image = None
    try:
        root = x.XDefaultRootWindow(display)
        deadline = time.monotonic() + 15
        window = None
        while window is None and time.monotonic() < deadline:
            if app.poll() is not None:
                raise RuntimeError(f'Marks application exited: {app.communicate()}')
            window = named_window(x, display, root, b'marked workspace')
            time.sleep(0.1)
        if window is None:
            raise RuntimeError('The marks workspace did not open')
        time.sleep(0.3)
        image = screenshot(x, display, window, 800, 600)
        save_png(image, project / '.cache/marks-native.png')
        close_window(x, display, window)
        output, errors = app.communicate(timeout=10)
        if app.returncode or errors:
            raise RuntimeError(f'Marks application failed: {app.returncode}, {errors!r}')
        horizontal, vertical = map(float, output.split())
        value = x.XGetPixel(image, int(horizontal), int(vertical))
        pixel = ((value >> 16) & 255, (value >> 8) & 255, value & 255)
        if not pixel[0] < pixel[1] < pixel[2] < 255:
            raise RuntimeError(f'The source mark was not composited below the Unicode text: {pixel}')
        print('Native editor marks: Unicode positioning, translucent background and cleanup passed.')
    finally:
        if image is not None:
            x.XDestroyImage(image)
        if app.poll() is None:
            app.terminate(); app.wait(timeout=5)
        x.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('compiler', type=Path)
    parser.add_argument('--drive', type=Path)
    args = parser.parse_args()
    project, compiler = args.project.resolve(), args.compiler.resolve()
    if args.drive:
        drive(project, args.drive.resolve()); return
    xvfb = shutil.which('xvfb-run')
    if not xvfb:
        parser.error('Native mark tests require xvfb-run')
    with tempfile.TemporaryDirectory(prefix='dynlex-marks-ui-') as temporary:
        executable = Path(temporary) / 'marks.out'
        subprocess.run([str(compiler), 'tests/runtime/marks.dl', '-o', str(executable)], cwd=project, check=True)
        subprocess.run([xvfb, '-a', '-s', '-screen 0 1000x760x24', sys.executable, str(Path(__file__).resolve()),
                        str(project), str(compiler), '--drive', str(executable)],
                       cwd=project, env=private_display_environment(), check=True, timeout=40)


if __name__ == '__main__':
    main()
