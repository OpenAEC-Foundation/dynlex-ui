#!/usr/bin/env python3
"""Compile a UI client outside the SDK and its working directory."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    compiler = args.dynlex.resolve() / 'build/dynlex'
    with tempfile.TemporaryDirectory(prefix='dynlex-ui-client-') as temporary:
        folder = Path(temporary)
        source = folder / 'main.dl'
        for platform in ['native', 'browser']:
            source.write_text(f'import {project / "ui" / (platform + ".dl")}\n'
                              'window client window:\n    button "Hello"\n'
                              'set instance to an instance of client window\n'
                              'close the address of instance\n')
            report = subprocess.run([str(compiler), str(source), '--dump-dependencies'], cwd=folder,
                                    check=True, capture_output=True, text=True)
            graph = json.loads(report.stdout)
            assert graph['complete'], graph
            output = folder / ('client.wasm' if platform == 'browser' else 'client.out')
            command = [str(compiler), str(source), '-o', str(output)]
            if platform == 'browser':
                command += ['--emit-wasm']
            subprocess.run(command, cwd=folder, check=True)
            if platform == 'native':
                subprocess.run([str(output)], cwd=folder, check=True)
            else:
                assert not any('/platform/native/' in path for path in graph['sources']), graph
            print(f'{platform}: external client imports and compiles without the SDK working directory', flush=True)


if __name__ == '__main__':
    main()
