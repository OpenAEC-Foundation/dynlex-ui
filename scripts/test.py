#!/usr/bin/env python3
"""Verify shared UI logic at both optimization levels; optional isolated platform checks."""
import argparse
from pathlib import Path
import os
import shutil
import socket
import subprocess
import sys
import tempfile


def main():
    project = Path(__file__).resolve().parents[1]
    cases = {source.parent.relative_to(project / 'tests').as_posix(): source
             for source in sorted(project.glob('tests/*/*/main.dl'))}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dynlex', type=Path, required=True)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--case', action='append', choices=list(cases),
                        help='Run only this shared fixture; repeat to select several (default: all).')
    args = parser.parse_args()
    subprocess.run([sys.executable, 'scripts/generate_source_colors.py',
                    '--dynlex', str(args.dynlex.resolve()), '--check'], cwd=project, check=True)
    subprocess.run([sys.executable, 'tests/packaging/runtime_modules.py'], cwd=project, check=True)
    subprocess.run([sys.executable, 'tests/packaging/application_notices.py'], cwd=project, check=True)
    compiler = args.dynlex.resolve() / 'build/dynlex'
    if not compiler.is_file():
        parser.error(f'Build the compiler first: {compiler}')
    subprocess.run(["python3", "scripts/test_external_imports.py", "--dynlex", str(args.dynlex.resolve())], cwd=project, check=True)
    count = 0
    with tempfile.TemporaryDirectory(prefix='dynlex-ui-tests-') as temporary:
        for name, source in cases.items():
            if args.case and name not in args.case:
                continue
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
        manifest = subprocess.check_output([sys.executable,
            str(args.dynlex.resolve() / 'scripts/find_vulkan_icd.py')], text=True).strip()
        native_environment = dict(os.environ, VK_DRIVER_FILES=manifest, VK_ICD_FILENAMES=manifest)
        for name in ['sections', 'ribbon', 'snake', 'text', 'pictures', 'marks']:
            subprocess.run(['python3', f'scripts/test_{"ui_sections" if name == "sections" else name + "_ui"}.py',
                            str(project), str(compiler)], cwd=project, env=native_environment, check=True)
        subprocess.run(["python3", "scripts/test_application_lifetime.py", "--dynlex", str(args.dynlex.resolve())], cwd=project, env=native_environment, check=True)
    if args.browser:
        subprocess.run(['node', 'tests/browser/input_keys.mjs'], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/service_provider.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/driver_integer_widths.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/source_features.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/source_connection.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/shader_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/shader_passes.mjs'], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/shader_operation_widths.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/shader_value_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        for fixture in ['shader_api', 'shader_resources', 'shader_attachments', 'shader_graph', 'option_models', 'scene_tone', 'shader_pipelines', 'scene_draws', 'scene_orbit', 'scene_motion', 'scene_attachments', 'scene_lighting', 'scene_sampling']:
            subprocess.run(['node', 'tests/browser/shared_frontends.mjs', str(args.dynlex.resolve()), fixture],
                           cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_mesh_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_transform_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_model_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_baking_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_rotation_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        subprocess.run(['node', 'tests/browser/scene_shader_ranges.mjs', str(args.dynlex.resolve())], cwd=project, check=True)
        for case in ['pictures_service', 'audio_service', 'timer_service', 'scheduling', 'service_calls', 'connectivity_service', 'shader_streams', 'shader_provoking_vertex', 'shader_services', 'shader_uniforms', 'shader_assets']:
            subprocess.run(['node', f'tests/browser/{case}.mjs'], cwd=project, check=True)
        for suite in ['resources', 'graph']:
            probe = project / f'.cache/shader-{suite}-probe'
            subprocess.run(['node', f'tests/browser/prepare_{suite}.mjs', str(args.dynlex.resolve()),
                            str(probe)], cwd=project, check=True)
            with socket.socket() as server_port, socket.socket() as debug_port:
                server_port.bind(('127.0.0.1', 0))
                debug_port.bind(('127.0.0.1', 0))
                ports = (server_port.getsockname()[1], debug_port.getsockname()[1])
            environment = dict(os.environ, DYNLEX_CORE=str(args.dynlex.resolve()),
                DYNLEX_TEST_WEB_ROOT=str(probe if suite == 'graph' else project),
                DYNLEX_TEST_WEB_SERVER='static', DYNLEX_TEST_GRAPHICS='webgpu',
                DYNLEX_TEST_SERVER_PORT=str(ports[0]), DYNLEX_TEST_DEBUG_PORT=str(ports[1]),
                DYNLEX_BROWSER_TEST_ENTRY=str(project / f'tests/browser/shader_{suite}_browser.mjs'))
            subprocess.run([str(args.dynlex.resolve() / 'scripts/test_web_browser.sh')], cwd=project,
                           env=environment, check=True)
        applications = [([name], f'dist/{name}') for name in ['ribbon', 'snake', 'text']]
        applications.append((['--entry', 'tests/browser/editor.dl', '--output', '.cache/editor'], '.cache/editor'))
        applications.append((['--entry', 'tests/browser/commands.dl', '--output', '.cache/commands'], '.cache/commands'))
        applications.append((['--entry', 'tests/browser/search.dl', '--output', '.cache/search'], '.cache/search'))
        applications.append((['--entry', 'tests/browser/forms.dl', '--output', '.cache/forms'], '.cache/forms'))
        applications.append((['--entry', 'tests/browser/pictures.dl', '--output', '.cache/browser/pictures'], '.cache/browser/pictures'))
        for arguments, directory in applications:
            subprocess.run(['python3', 'scripts/build.py', *arguments, '--dynlex', str(args.dynlex.resolve())], cwd=project, check=True)
            if directory == '.cache/browser/pictures':
                shutil.copytree(project / 'tests/assets/pictures', project / directory / 'tests/assets/pictures', dirs_exist_ok=True)
            xvfb = shutil.which('xvfb-run')
            if not xvfb:
                parser.error('Browser visual tests require xvfb-run')
            environment = dict(os.environ, DYNLEX_BACKGROUND_BROWSER='1', XDG_SESSION_TYPE='x11')
            environment.pop('WAYLAND_DISPLAY', None)
            environment.pop('WAYLAND_SOCKET', None)
            environment.pop('VK_DRIVER_FILES', None)
            environment.pop('VK_ICD_FILENAMES', None)
            for mode in ['webgpu', 'webgl-no-adapter', 'webgl-no-api']:
                subprocess.run([xvfb, '-a', '-s', '-screen 0 1400x1000x24', 'node', 'tests/browser/run.mjs', directory, mode, str(args.dynlex.resolve())], cwd=project, env=environment, check=True)


if __name__ == '__main__':
    main()
