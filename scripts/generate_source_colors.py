#!/usr/bin/env python3
"""Generate default source call styles from the compiler's canonical palette."""
import argparse
import json
from pathlib import Path


def source_colors(project, compiler):
    target = project / 'ui/source_annotations.dl'
    source = target.read_text()
    colors = json.loads((compiler / 'shared/call-colors.json').read_text())
    expected = source
    for theme in ['dark', 'light']:
        begin = f'    # Generated {theme} call colors begin\n'
        end = f'    # Generated {theme} call colors end\n'
        if expected.count(begin) != 1 or expected.count(end) != 1:
            raise ValueError(f'The {theme} source theme must declare one generated call-color region')
        before, region = expected.split(begin)
        _, after = region.split(end)
        rules = []
        for depth, color in enumerate(colors):
            channels = ' '.join(str(int(color[theme][index:index + 2], 16)) for index in [0, 2, 4])
            for kind in ['function', 'intrinsic', 'type']:
                rules.append(f'    @intrinsic("construct", UI source token style, "{kind}.callDepth{depth}", UI ink {channels})')
        expected = before + begin + ',\n'.join(rules) + '\n' + end + after
    return target, source, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    target, actual, expected = source_colors(project, args.dynlex.resolve())
    if args.check:
        if actual != expected:
            raise ValueError('Regenerate source colors with scripts/generate_source_colors.py --dynlex <compiler>')
    else:
        target.write_text(expected)


if __name__ == '__main__':
    main()
