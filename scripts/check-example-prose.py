#!/usr/bin/env python3
"""Run a complete example exactly as displayed, including its setup.

Use --port to choose a language and --output-dir for a new evidence directory.
Use --example guide --page guides/<name> for a shared tmux shell program.
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--example', choices=['capture', 'attach', 'query', 'concept', 'guide', 'api'], default='capture')
    parser.add_argument('--port')
    parser.add_argument('--page', help='Guide path, or page within the selected port')
    parser.add_argument('--api-model', type=Path, help='Review model for an unpublished source revision')
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads((repo / f'site/test/fixtures/{args.example}-examples.json').read_text())
    if args.example != 'guide' and not args.port:
        parser.error('--port is required for language examples')
    examples = [item for item in manifest['examples'] if args.example == 'guide' or item['port'] == args.port]
    if args.page:
        page_path = args.page if args.example == 'guide' else f'ports/{args.port}/{args.page}'
        examples = [item for item in examples if item['page'] == page_path]
    if len(examples) != 1:
        choices = ', '.join(item['page'] for item in examples)
        parser.error(f'Choose one example with --port and --page; matching pages: {choices or "none"}')
    example = examples[0]
    if args.api_model and args.example != 'api':
        parser.error('--api-model is only valid for API examples')
    page = (args.api_model or repo / 'site/src/data/api' / f'{args.port}.json') \
        if args.example == 'api' else repo / 'site/src/content/docs' / (example['page'] + '.md')
    content = page.read_text()
    if args.example == 'api':
        model = json.loads(content)
        symbols = [symbol for symbol in model['symbols'] if symbol['id'] == example['symbol']]
        if len(symbols) != 1:
            raise ValueError(f'Expected one API symbol: {example["symbol"]}')
        if symbols[0]['source']['revision'] != example['sourceRevision']:
            raise ValueError('API source revision differs from the verification record')
        api_blocks = symbols[0].get('doc', {}).get('examples', [])
        blocks = []
    else:
        blocks = list(re.finditer(r'^```(\S+)([^\n]*)\n(.*?)^```', content, re.M | re.S))
    files = {}
    for item in example['files']:
        name = item['name']
        path = Path(item.get('path', name))
        if path.is_absolute() or '..' in path.parts:
            raise ValueError(f'Invalid example filename: {name}')
        if args.example == 'api':
            block_index = item['block']
            matches = [api_blocks[block_index]['code']] if 0 <= block_index < len(api_blocks) else []
        else:
            matches = [block[3] for block in blocks if f'title="{name}"' in block[2]]
        if len(matches) != 1:
            raise ValueError(f'Expected one displayed file: {name}')
        code = matches[0]
        if hashlib.sha256(code.encode()).hexdigest() != item['sha256']:
            raise ValueError(f'Changed example bytes: {name}; review its verification record')
        files[str(path)] = code
    command_blocks = [block['code'] for block in api_blocks if block['lang'] == 'console'] \
        if args.example == 'api' else [block[3] for block in blocks if block[1] == 'console']
    commands = [re.sub(r'^\$ ', '', code, flags=re.M).strip() for code in command_blocks]
    if not commands or commands != example['shellRecipe']:
        raise ValueError('Setup commands differ from the verification record')
    expected = example.get('expectedOutputs', [[] for _ in commands[:-1]] +
                           [[example.get('expectedOutput', 'libtmux capture ready')]])
    if len(expected) != len(commands):
        raise ValueError('Expected output must be recorded for each setup or run command')

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
        print(f'Running {example["page"]}; log: {log}', flush=True)
        with log.open('w') as stream:
            result = subprocess.run(['sh', '-eu', '-c', command], cwd=output,
                                    env=env, stdout=stream, stderr=subprocess.STDOUT)
        missing = [line for line in expected[index] if line not in log.read_text().splitlines()]
        results.append({'command': command, 'exit': result.returncode,
                        'seconds': round(time.monotonic() - start, 3), 'missingOutput': missing})
        if result.returncode or missing:
            break
    passed = len(results) == len(commands) and all(
        row['exit'] == 0 and not row['missingOutput'] for row in results)
    report = {'port': example['port'], 'page': example['page'], 'sourceRevision': example['sourceRevision'],
              'tmuxVersion': subprocess.check_output(['tmux', '-V'], text=True).strip(),
              'pageSha256': hashlib.sha256(page.read_bytes()).hexdigest(),
              'files': example['files'], 'runs': results, 'passed': passed,
              'scope': 'Exact displayed program and setup; native execution on this host.'}
    (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
