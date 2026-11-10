#!/usr/bin/env python3
"""Verify native image decoding and rendering on a private X display."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from native_ui_test import click, close_window, named_window, private_display_environment, save_png, screenshot, x11_library


def drive(project, executable):
    x = x11_library()
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('The private X display is unavailable')
    app = subprocess.Popen([str(executable)], cwd=project, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        root = x.XDefaultRootWindow(display)
        window = None
        deadline = time.monotonic() + 15
        while window is None and time.monotonic() < deadline:
            if app.poll() is not None:
                raise RuntimeError(f'The image application exited: {app.communicate()}')
            window = named_window(x, display, root, b'picture workspace')
            time.sleep(0.1)
        if window is None:
            raise RuntimeError('The image application did not open')

        def verify(name, first, second):
            time.sleep(0.3)
            image = screenshot(x, display, window, 800, 600)
            try:
                save_png(image, project / '.cache' / name)
                for horizontal, expected in [(340, first), (460, second)]:
                    value = x.XGetPixel(image, horizontal, 80)
                    actual = ((value >> 16) & 255, (value >> 8) & 255, value & 255)
                    if any(abs(a-b) > 1 for a, b in zip(actual, expected)):
                        raise RuntimeError(f'Image pixel {horizontal},80 was {actual}, expected {expected}')
            finally:
                x.XDestroyImage(image)
        verify('pictures-native.webp.png', (255, 0, 0), (0, 200, 100))
        click(x, display, root, window, 400, 180)
        verify('pictures-native.svg.png', (36, 90, 207), (239, 179, 40))
        close_window(x, display, window)
        output, errors = app.communicate(timeout=10)
        if app.returncode or output or errors:
            raise RuntimeError(f'Image application failed to close: {app.returncode}, {output!r}, {errors!r}')
        print('Native pictures: WebP/PNG rendering, SVG source replacement and cleanup passed.')
    finally:
        if app.poll() is None:
            app.terminate()
            app.wait(timeout=5)
        x.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('compiler', type=Path)
    parser.add_argument('--drive', type=Path)
    args = parser.parse_args()
    project, compiler = args.project.resolve(), args.compiler.resolve()
    if args.drive:
        drive(project, args.drive.resolve())
        return
    xvfb = shutil.which('xvfb-run')
    if not xvfb:
        parser.error('Native picture tests require xvfb-run')
    (project / '.cache').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dynlex-pictures-ui-') as temporary:
        temporary = Path(temporary)
        for source, name in [('tests/runtime/image_decode.dl', 'decode'), ('tests/runtime/pictures.dl', 'pictures')]:
            executable = temporary / f'{name}.out'
            subprocess.run([str(compiler), source, '-o', str(executable)], cwd=project, check=True)
            if name == 'decode':
                subprocess.run([str(executable)], cwd=project, check=True, timeout=30)
            else:
                subprocess.run([xvfb, '-a', '-s', '-screen 0 1000x760x24', sys.executable, str(Path(__file__).resolve()),
                                str(project), str(compiler), '--drive', str(executable)],
                               cwd=project, env=private_display_environment(), check=True, timeout=50)


if __name__ == '__main__':
    main()
