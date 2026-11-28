import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const python = (code: string) => JSON.parse(execFileSync('python3', ['-B', '-c', `
import importlib.util, json
spec = importlib.util.spec_from_file_location('sandbox', 'scripts/example_tmux_sandbox.py')
sandbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sandbox)
${code}
`], { cwd: root, encoding: 'utf8' }))

describe('native capture witness', () => {
  it('binds raw program bytes to the final native capture and its pane generation', () => {
    expect(python(`
data = b'native\\xffline\\n'
entry = dict(socket='/private/socket', pane='%7', statuses=[0] * 5,
             generationBeforeHex=b'123 456 %7\\n'.hex(), generationAfterHex=b'123 456 %7\\n'.hex(),
             beforeHex=data.hex(), afterHex=data.hex(), libraryStdoutHex=data.hex())
print(json.dumps(sandbox.native_capture_witness(data, [entry])))`)).toEqual({
      socket: '/private/socket', pane: '%7', generation: { pid: 123, started: 456 },
      beforeHex: Buffer.from('native\xffline\n', 'latin1').toString('hex'),
      afterHex: Buffer.from('native\xffline\n', 'latin1').toString('hex'),
    })
  })

  it('refuses missing, interrupted, changed, partial and mismatched final evidence', () => {
    expect(python(`
data = b'native\\n'
entry = dict(socket='/private/socket', pane='%7', statuses=[0] * 5,
             generationBeforeHex=b'123 456 %7\\n'.hex(), generationAfterHex=b'123 456 %7\\n'.hex(),
             beforeHex=data.hex(), afterHex=data.hex(), libraryStdoutHex=data.hex())
changes = [dict(statuses=[0, 0, 1, 0, 0]), dict(statuses=[0, 0, None, 0, 0]),
           dict(afterHex=b'changed\\n'.hex()), dict(libraryStdoutHex=b'other\\n'.hex()),
           dict(generationAfterHex=b'124 456 %7\\n'.hex()),
           dict(generationAfterHex=b'123 456 %7'.hex()), dict(pane='%8')]
for candidates in [[], *[[entry, dict(entry, **change)] for change in changes]]:
    try:
        sandbox.native_capture_witness(data, candidates)
    except ValueError:
        continue
    raise AssertionError(candidates)
print(json.dumps(len(changes) + 1))`)).toBe(8)
  })

  it('records an unmodified command through the standalone stdlib entrypoint', () => {
    expect(python(`
import os, pathlib, subprocess, sys, tempfile
with tempfile.TemporaryDirectory(prefix='capture-recorder-test-') as temporary:
    root = pathlib.Path(temporary)
    binary = root / 'tmux'
    binary.write_text('#!' + sys.executable + '\\nimport sys\\n'
                      'if "display-message" in sys.argv: print("123 456 %7")\\n'
                      'elif "capture-pane" in sys.argv: sys.stdout.buffer.write(bytes.fromhex("6e6174697665ff6c696e650a"))\\n')
    binary.chmod(0o700)
    program = root / 'program.py'
    program.write_text('import subprocess, sys\\n'
                       'sys.stdout.buffer.write(subprocess.check_output(["tmux", "-N", "-S", '
                       + repr(str(root / 'absent.sock')) + ', "capture-pane", "-p", "-t", "%7", "-e"]))\\n')
    output = root / 'record'
    result = subprocess.run([sys.executable, 'scripts/example_tmux_sandbox.py',
                             '--output-dir', str(output), '--require-capture', '--',
                             sys.executable, str(program)],
                            env=dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH']),
                            capture_output=True, check=True)
    record = json.loads((output / 'result.json').read_text())
    assert record['passed'] and record['native']['pane'] == '%7'
    assert result.stdout == (output / 'stdout.bin').read_bytes() == bytes.fromhex(record['stdoutHex'])
    trace = json.loads((output / 'tmux-commands.jsonl').read_text().splitlines()[0])
    assert trace['args'][-1] == '-e'
    print(json.dumps(record['stdoutHex']))`)).toBe('6e6174697665ff6c696e650a')
  })

  it('keeps JSON app stdio separate from the optional pane capture record', () => {
    expect(python(`
import os, pathlib, subprocess, sys, tempfile
with tempfile.TemporaryDirectory(prefix='capture-app-test-') as temporary:
    root = pathlib.Path(temporary)
    binary = root / 'tmux'
    binary.write_text('#!' + sys.executable + '\\nimport sys\\n'
                      'if "display-message" in sys.argv: print("123 456 %7")\\n'
                      'elif "capture-pane" in sys.argv: print("native")\\n')
    binary.chmod(0o700)
    program = root / 'program.py'
    program.write_text('import json, subprocess\\n'
                       'data = subprocess.check_output(["tmux", "-S", '
                       + repr(str(root / 'absent.sock')) + ', "capture-pane", "-p", "-t", "%7"])\\n'
                       'print(json.dumps(dict(output=data.decode())))\\n')
    output = root / 'record'
    result = subprocess.run([sys.executable, 'scripts/example_tmux_sandbox.py',
                             '--output-dir', str(output), '--record-captures', '--',
                             sys.executable, str(program)],
                            env=dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH']),
                            capture_output=True, check=True)
    record = json.loads((output / 'result.json').read_text())
    assert record['passed'] and record['native'] is None and record['profile'] == 'stdio'
    captures = [json.loads(line) for line in (output / 'native-captures.jsonl').read_text().splitlines()]
    screen = json.loads(result.stdout)['output'].encode()
    witness = sandbox.native_capture_witness(screen, captures)
    print(json.dumps(witness['beforeHex']))`)).toBe(Buffer.from('native\n').toString('hex'))
  })
})
