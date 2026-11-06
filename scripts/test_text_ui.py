#!/usr/bin/env python3
"""Edit and copy through the native adapter on a private X server."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from native_ui_test import click, close_window, named_window, press_key, private_display_environment, save_png, screenshot, x11_library


def drive(project, executable, snapshot):
    x = x11_library()
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('The private X display is unavailable')
    app = subprocess.Popen([str(executable)], cwd=project, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        root = x.XDefaultRootWindow(display)
        window = None
        deadline = time.monotonic() + 10
        while window is None and time.monotonic() < deadline:
            if app.poll() is not None:
                raise RuntimeError(f'The editor exited: {app.communicate()}')
            window = named_window(x, display, root, b'writing room')
            time.sleep(0.1)
        if window is None:
            raise RuntimeError('The editor did not open')
        time.sleep(0.4)
        click(x, display, root, window, 180, 250)
        def key(symbol, modifiers=0):
            press_key(x, display, root, window, symbol, interval=0.04, modifiers=modifiers)
        key(ord('v'), 4)  # An empty clipboard is a valid no-op.
        key(ord('a'), 4)
        for character in 'shared':
            key(ord(character))
        key(0xFF51, 1)  # Shift-left selects the d.
        key(ord('x'), 4)
        key(ord('v'), 4)  # Paste through GLFW into the shared text event queue.
        if snapshot:
            time.sleep(0.2)
            image = screenshot(x, display, window, 960, 640)
            save_png(image, snapshot)
            x.XDestroyImage(image)
        close_window(x, display, window)
        output, errors = app.communicate(timeout=10)
        if app.returncode or errors or output != 'shared\n':
            raise RuntimeError(f'Native editing failed: exit={app.returncode}, output={output!r}, errors={errors!r}')
        print('Native text editing, selection, cut and paste passed.')
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
    parser.add_argument('--snapshot', type=Path)
    args = parser.parse_args()
    project, compiler = args.project.resolve(), args.compiler.resolve()
    if args.drive:
        drive(project, args.drive.resolve(), args.snapshot)
        return
    xvfb = shutil.which('xvfb-run')
    if not xvfb:
        parser.error('Native tests require xvfb-run')
    with tempfile.TemporaryDirectory(prefix='dynlex-text-ui-') as temporary:
        executable = Path(temporary) / 'text.out'
        subprocess.run([str(compiler), 'tests/runtime/text_editing.dl', '-o', str(executable)], cwd=project, check=True)
        command = [xvfb, '-a', '-s', '-screen 0 1100x760x24', sys.executable, str(Path(__file__).resolve()), str(project), str(compiler), '--drive', str(executable)]
        if args.snapshot:
            command += ['--snapshot', str(args.snapshot.resolve())]
        subprocess.run(command, cwd=project, env=private_display_environment(), check=True, timeout=40)


if __name__ == '__main__':
    main()
