import type { ApiModel } from '@libtmux/api-model'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertCompleteApiExample } from '../scripts/check-clipboard.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const python = (code: string) =>
  JSON.parse(
    execFileSync(
      'python3',
      [
        '-B',
        '-c',
        `
import importlib.util, json, pathlib, re
spec = importlib.util.spec_from_file_location('runner', 'scripts/check-example-prose.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
${code}
`,
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  )
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('complete API example selection', () => {
  it('keeps the current fixtures and their exact displayed commands selectable', () => {
    const results = python(`
manifest = json.loads(pathlib.Path('site/test/fixtures/api-examples.json').read_text())
models = {port: json.loads(pathlib.Path('site/src/data/api/' + port + '.json').read_text())
          for port in {example['port'] for example in manifest['examples']}}
results = []
for example in manifest['examples']:
    page = example['page'].removeprefix('ports/' + example['port'] + '/')
    selected = runner.select_examples(manifest, 'api', example['port'], page, example.get('sourceProgramId'))
    assert selected == [example], example['page']
    model = models[example['port']]
    symbol = next(symbol for symbol in model['symbols'] if symbol['id'] == example['symbol'])
    commands = [re.sub(r'^\\$ ', '', code, flags=re.M).strip()
                for code in runner.api_command_blocks(symbol['doc']['examples'], example)]
    assert commands == example['shellRecipe'], example['page']
    results.append(example['port'])
print(json.dumps(results))`)
    expect(results.length).toBeGreaterThanOrEqual(20)
    expect(results).toContain('go')
    expect(results).toContain('lua')
  })

  it('selects one program on a shared page without including another setup', () => {
    expect(
      python(`
examples = [{'port': 'java', 'page': 'ports/java/reference/server-sessions', 'sourceProgramId': name}
            for name in ['java-ListSessions', 'java-Query']]
manifest = {'examples': examples}
assert runner.select_examples(manifest, 'api', 'java', 'reference/server-sessions') == examples
assert runner.select_examples(manifest, 'api', 'java', 'reference/server-sessions', 'missing') == []
assert runner.select_examples(manifest, 'api', 'kotlin', 'reference/server-sessions', 'java-Query') == []
selected = runner.select_examples(manifest, 'api', 'java', 'reference/server-sessions', 'java-Query')
assert selected == [examples[1]]
blocks = [{'lang': 'console', 'code': 'first setup'}, {'lang': 'java', 'code': 'first program'},
          {'lang': 'console', 'code': 'first run'}, {'lang': 'console', 'code': 'second setup'},
          {'lang': 'java', 'code': 'second program'}, {'lang': 'console', 'code': 'second run'}]
print(json.dumps(runner.api_command_blocks(blocks, {'consoleBlocks': [3, 5]})))`),
    ).toEqual(['second setup', 'second run'])
  })

  it('rejects duplicate, non-console, invalid and empty command selections', () => {
    expect(
      python(`
blocks = [{'lang': 'console', 'code': 'setup'}, {'lang': 'java', 'code': 'program'}]
for indices in [[0, 0], [1], [-1], [2], [True], []]:
    try:
        runner.api_command_blocks(blocks, {'consoleBlocks': indices})
    except ValueError:
        continue
    raise AssertionError(indices)
print(json.dumps(runner.api_command_blocks(blocks, {})))`),
    ).toEqual(['setup'])
  })
})

describe('homepage native verification ownership', () => {
  it('preserves an existing parent when a probed socket was never created', () => {
    expect(
      python(`
import os, sys, tempfile
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from example_tmux_sandbox import ExampleTmuxSandbox
with tempfile.TemporaryDirectory(prefix='home-parent-test-') as directory:
    output = pathlib.Path(directory)
    parent = output / 'pre-existing'
    parent.mkdir()
    with patch('example_tmux_sandbox.shutil.which', return_value='/bin/true'):
        sandbox = ExampleTmuxSandbox(output, dict(os.environ))
    sandbox.trace.write_text(json.dumps(dict(socket=str(parent / 'absent.sock'), existed=False)) + '\\n')
    sandbox.finish(True)
    print(json.dumps(parent.is_dir()))`),
    ).toBe(true)
  })

  it('does not treat permission errors and timeouts as proof of socket exit', () => {
    expect(
      python(`
import errno, sys
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from example_tmux_sandbox import socket_running
with patch('example_tmux_sandbox.socket.socket') as socket:
    connect = socket.return_value.__enter__.return_value.connect
    for failure in [PermissionError(errno.EACCES, 'denied'), TimeoutError()]:
        connect.side_effect = failure
        try:
            socket_running('/private/unverified.sock')
        except type(failure):
            pass
        else:
            raise AssertionError('ambiguous socket reported stopped')
    for number in [errno.ENOENT, errno.ECONNREFUSED]:
        connect.side_effect = OSError(number, 'stopped')
        assert not socket_running('/private/stopped.sock')
print(json.dumps(True))`),
    ).toBe(true)
  })

  it('kills surviving descendants even when their shell already exited', () => {
    expect(
      python(`
import signal
from unittest.mock import Mock, call, patch
process = Mock(pid=12345)
process.wait.return_value = 0
with patch.object(runner.os, 'killpg') as kill:
    runner.stop_process_group(process)
    assert kill.call_args_list == [call(12345, signal.SIGTERM), call(12345, signal.SIGKILL)]
print(json.dumps(True))`),
    ).toBe(true)
  })

  it('records joined socket flags without changing the tmux arguments', () => {
    expect(
      python(`
import os, sys, tempfile
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from example_tmux_sandbox import ExampleTmuxSandbox
with tempfile.TemporaryDirectory(prefix='home-native-test-') as directory:
    output = pathlib.Path(directory)
    with patch('example_tmux_sandbox.shutil.which', return_value='/bin/true'):
        sandbox = ExampleTmuxSandbox(output, dict(os.environ))
    recorded = output / 'argv.json'
    fake = output / 'fake-tmux'
    fake.write_text('#!' + sys.executable + '\\nimport json, sys\\n' +
                   'open(' + repr(str(recorded)) + ', "w").write(json.dumps(sys.argv[1:]))\\n')
    fake.chmod(0o700)
    wrapper = output / 'native-tools/tmux'
    wrapper.write_text(wrapper.read_text().replace(repr(sandbox.binary), repr(str(fake))))
    socket = output / 'owned.sock'
    args = ['-S' + str(socket), '-f', '/dev/null', 'list-sessions']
    import subprocess
    subprocess.run([str(wrapper), *args], env=sandbox.env, check=True)
    assert json.loads(recorded.read_text()) == args
    trace = json.loads(sandbox.trace.read_text())
    assert trace['socket'] == str(socket) and not trace['existed']
    report = sandbox.finish(True)
    assert report['passed']
    print(json.dumps(report['endpoints'][0]['runningAfterHarness']))`),
    ).toBe(false)
  })

  it('fails verification without stopping or unlinking a pre-existing socket', () => {
    expect(
      python(`
import os, socket, sys, tempfile
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from example_tmux_sandbox import ExampleTmuxSandbox
with tempfile.TemporaryDirectory(prefix='home-foreign-test-') as directory:
    output = pathlib.Path(directory)
    path = output / 'foreign.sock'
    with patch('example_tmux_sandbox.shutil.which', return_value='/bin/true'):
        sandbox = ExampleTmuxSandbox(output, dict(os.environ))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(str(path))
        listener.listen()
        sandbox.trace.write_text(json.dumps(dict(socket=str(path), existed=True)) + '\\n')
        with patch('example_tmux_sandbox.subprocess.run') as stop:
            report = sandbox.finish(False)
            stop.assert_not_called()
        assert path.exists()
        assert report['endpoints'][0]['runningAfterHarness']
        print(json.dumps(report['passed']))`),
    ).toBe(false)
  })
})

describe('API example source and clipboard receipts', () => {
  const fixture = () => {
    const revision = 'a'.repeat(40)
    const href = `https://github.com/libtmux/libtmux-java/blob/${revision}/examples/api/run.sh`
    const link = { href, label: 'View source' }
    const rendered = {
      text: '',
      links: [link, link],
      sourceLinks: [[link], [], [link], []],
      files: ['whole launcher', 'first recipe', 'whole launcher', 'second recipe'],
    }
    const example = {
      symbol: 'Server.sessions',
      sourceRepository: 'libtmux/libtmux-java',
      sourceRevision: revision,
      sourceFile: 'examples/api/run.sh',
      consoleBlocks: [3],
      shellRecipe: ['second recipe'],
      files: [
        {
          block: 2,
          name: 'run.sh',
          sourceFile: 'examples/api/run.sh',
          sha256: hash('whole launcher\n'),
          clipboardSha256: hash('whole launcher'),
        },
      ],
    }
    return { rendered, example }
  }

  it('retains the current fixture source links, file hashes and recipes', () => {
    const manifest = JSON.parse(readFileSync(new URL('./fixtures/api-examples.json', import.meta.url), 'utf8'))
    const models = new Map<string, ApiModel>()
    for (const example of manifest.examples) {
      let model = models.get(example.port)
      if (!model) {
        model = JSON.parse(
          readFileSync(new URL(`../src/data/api/${example.port}.json`, import.meta.url), 'utf8'),
        ) as ApiModel
        models.set(example.port, model)
      }
      const symbol = model.symbols.find((entry) => entry.id === example.symbol)!
      const blocks = symbol.doc!.examples as { sourceUrl?: string; code: string; lang: string }[]
      const sourceLinks = blocks.map((block) =>
        block.sourceUrl ? [{ href: block.sourceUrl, label: 'View source' }] : [],
      )
      const rendered = {
        text: '',
        links: sourceLinks.flat(),
        sourceLinks,
        files: blocks.map((block) =>
          block.lang === 'console' ? block.code.replace(/^\$ /gm, '').trim() : block.code.replace(/\n$/, ''),
        ),
      }
      expect(() => assertCompleteApiExample(rendered, example), example.symbol).not.toThrow()
    }
  })

  it('accepts the same setup source on two independent programs', () => {
    const { rendered, example } = fixture()
    expect(() => assertCompleteApiExample(rendered, example)).not.toThrow()
  })

  it('rejects a source link missing beside its file even when another program has it', () => {
    const { rendered, example } = fixture()
    rendered.sourceLinks[2] = []
    expect(() => assertCompleteApiExample(rendered, example)).toThrow('exact pinned source')
  })

  it('rejects duplicate or incorrect source citations beside the selected file', () => {
    const duplicate = fixture()
    duplicate.rendered.sourceLinks[2].push(duplicate.rendered.sourceLinks[2][0])
    expect(() => assertCompleteApiExample(duplicate.rendered, duplicate.example)).toThrow('exact pinned source')
    const wrong = fixture()
    wrong.rendered.sourceLinks[2] = [
      { href: 'https://github.com/libtmux/libtmux-java/blob/main/run.sh', label: 'View source' },
    ]
    expect(() => assertCompleteApiExample(wrong.rendered, wrong.example)).toThrow('exact pinned source')
  })

  it('rejects altered file bytes or the other program setup', () => {
    const bytes = fixture()
    bytes.rendered.files[2] += ' changed'
    expect(() => assertCompleteApiExample(bytes.rendered, bytes.example)).toThrow('exact clipboard bytes')
    const commands = fixture()
    commands.example.consoleBlocks = [1]
    expect(() => assertCompleteApiExample(commands.rendered, commands.example)).toThrow('copied setup and run commands')
  })
})
