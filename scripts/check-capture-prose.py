#!/usr/bin/env python3
"""Run a complete capture example exactly as displayed, including its setup.

Use --port to choose a language and --output-dir for a new evidence directory.
The selected language's native tools, Git, and tmux must already be on PATH.
This downloads and builds dependencies; it belongs outside routine site tests.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


def main():
    repo = Path(__file__).resolve().parent.parent
    manifest = json.loads((repo / 'site/test/fixtures/capture-examples.json').read_text())
    examples = {item['port']: item for item in manifest['examples']}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True, choices=examples)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    example = examples[args.port]
    page = repo / 'site/src/content/docs' / (example['page'] + '.md')
    content = page.read_text()
    blocks = list(re.finditer(r'^```(\S+)([^\n]*)\n(.*?)^```', content, re.M | re.S))
    files = {}
    for item in example['files']:
        name = item['name']
        path = Path(item.get('path', name))
        if path.is_absolute() or '..' in path.parts:
            raise ValueError(f'Invalid example filename: {name}')
        matches = [block[3] for block in blocks if f'title="{name}"' in block[2]]
        if len(matches) != 1:
            raise ValueError(f'Expected one displayed file: {name}')
        code = matches[0]
        if hashlib.sha256(code.encode()).hexdigest() != item['sha256']:
            raise ValueError(f'Changed example bytes: {name}; review its verification record')
        files[str(path)] = code
    commands = [re.sub(r'^\$ ', '', block[3], flags=re.M).strip()
                for block in blocks if block[1] == 'console']
    if not commands or commands != example['shellRecipe']:
        raise ValueError('Setup commands differ from the verification record')

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    for name, code in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(code)
    env = dict(os.environ)
    env.pop('TMUX', None)
    env.pop('TMUX_PANE', None)
    results = []
    for index, command in enumerate(commands):
        start = time.monotonic()
        log = output / f'run-{index + 1}.log'
        print(f'Running {args.port}; log: {log}', flush=True)
        with log.open('w') as stream:
            result = subprocess.run(['sh', '-eu', '-c', command], cwd=output,
                                    env=env, stdout=stream, stderr=subprocess.STDOUT)
        results.append({'command': command, 'exit': result.returncode,
                        'seconds': round(time.monotonic() - start, 3)})
        if result.returncode:
            break
    passed = all(row['exit'] == 0 for row in results)
    passed = passed and 'libtmux capture ready' in log.read_text().splitlines()
    report = {'port': args.port, 'sourceRevision': example['sourceRevision'],
              'pageSha256': hashlib.sha256(page.read_bytes()).hexdigest(),
              'files': example['files'], 'runs': results, 'passed': passed,
              'scope': 'Exact displayed program and setup; native execution on this host.'}
    (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
