"""Observe and retire only the tmux endpoints created by a native example.

The executable wrapper records explicit socket selections and then execs the
real tmux binary. It does not add setup code or change the copied program.
"""

import json
import errno
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time


def socket_running(path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.2)
        try:
            client.connect(str(path))
            return True
        except OSError as error:
            if error.errno in (errno.ENOENT, errno.ECONNREFUSED):
                return False
            raise


def wait_for_socket_exit(path, seconds=2):
    deadline = time.monotonic() + seconds
    while socket_running(path):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.01)
    return True


def retire_marked_directory(path, entry):
    """Remove an unchanged directory marked by this replay's process session."""
    directory = path.parent
    marker = directory / 'owner'
    try:
        current = directory.lstat()
        if not stat.S_ISDIR(current.st_mode) or [current.st_dev, current.st_ino] != entry['directoryIdentity']:
            return 'directory identity changed'
        if marker.read_text().strip() != str(entry['directoryOwner']):
            return 'owner marker changed'
        if any(child.name != 'owner' for child in directory.iterdir()):
            return 'directory has other files'
        marker.unlink()
        directory.rmdir()
    except FileNotFoundError:
        if directory.exists():
            return 'owner marker is absent'
    except OSError as error:
        return str(error)
    return None


class ExampleTmuxSandbox:
    def __init__(self, output, env):
        self.binary = str(Path(shutil.which('tmux', path=env['PATH'])).resolve())
        self.directory = Path(tempfile.mkdtemp(prefix='ltx-example-'))
        self.trace = output / 'tmux-commands.jsonl'
        bindir = output / 'native-tools'
        bindir.mkdir()
        wrapper = bindir / 'tmux'
        wrapper.write_text(f'''#!{sys.executable}
import json, os, sys
from pathlib import Path

args = sys.argv[1:]
endpoint = None
i = 0
while i < len(args) and args[i].startswith('-'):
    option = args[i]
    if len(option) > 2 and option[:2] in ('-L', '-S'):
        args[i:i + 1] = [option[:2], option[2:]]
        option = args[i]
    if option in ('-L', '-S', '-f', '-T', '-c'):
        if i + 1 >= len(args):
            break
        value = args[i + 1]
        if option == '-S':
            endpoint = str(Path(value).absolute())
        elif option == '-L' and '/' not in value:
            endpoint = str(Path(os.environ['TMUX_TMPDIR']) /
                           ('tmux-' + str(os.getuid())) / value)
        i += 2
    else:
        i += 1
if endpoint:
    alias = None
    directory_owner = None
    directory_identity = None
    try:
        directory = Path(endpoint).parent
        owner = int((directory / 'owner').read_text().strip())
        if owner > 0 and os.getsid(owner) == os.getsid(0) and not directory.is_symlink():
            current = directory.stat()
            directory_owner = owner
            directory_identity = [current.st_dev, current.st_ino]
    except (OSError, ValueError):
        pass
    trace = Path({str(self.trace)!r})
    if Path(endpoint).exists() and trace.exists():
        current = os.stat(endpoint)
        for line in trace.read_text().splitlines():
            prior = json.loads(line)
            if prior['existed'] or not Path(prior['socket']).exists():
                continue
            try:
                known = os.stat(prior['socket'])
            except FileNotFoundError:
                continue
            if (current.st_dev, current.st_ino) == (known.st_dev, known.st_ino):
                alias = prior['socket']
                break
    entry = json.dumps(dict(socket=endpoint,
                            existed=Path(endpoint).exists(), aliasOf=alias,
                            directoryOwner=directory_owner,
                            directoryIdentity=directory_identity,
                            args=sys.argv[1:]))
    descriptor = os.open({str(self.trace)!r},
                         os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(descriptor, (entry + '\\n').encode())
    os.close(descriptor)
os.execv({self.binary!r}, [{self.binary!r}, *sys.argv[1:]])
''')
        wrapper.chmod(0o700)
        self.env = dict(env, PATH=f'{bindir}{os.pathsep}{env["PATH"]}',
                        TMUX_TMPDIR=str(self.directory),
                        TMUX_BIN=str(wrapper), LIBTMUX_TMUX=str(wrapper))

    def finish(self, require_cleanup):
        first = {}
        if self.trace.exists():
            for line in self.trace.read_text().splitlines():
                entry = json.loads(line)
                first.setdefault(entry['socket'], entry)
        endpoints = []
        for name, entry in first.items():
            path = Path(name)
            running = not wait_for_socket_exit(path) if require_cleanup else socket_running(path)
            row = dict(socket=name, preexisting=entry['existed'],
                       aliasOf=entry.get('aliasOf'), runningAfterProgram=running)
            # Never stop a server that existed before this example selected it.
            if not entry['existed']:
                if running:
                    result = subprocess.run(
                        [self.binary, '-S', name, 'kill-server'],
                        env=self.env, capture_output=True, text=True, timeout=5,
                    )
                    row['harnessStopExit'] = result.returncode
                    row['harnessStopStderr'] = result.stderr
                row['runningAfterHarness'] = not wait_for_socket_exit(path)
                if not row['runningAfterHarness']:
                    if path.exists() and stat.S_ISSOCK(path.lstat().st_mode):
                        path.unlink(missing_ok=True)
                    if entry.get('directoryOwner') is not None:
                        retention = retire_marked_directory(path, entry)
                        row['directoryRetired'] = retention is None
                        if retention:
                            row['directoryRetention'] = retention
            else:
                row['runningAfterHarness'] = running
            endpoints.append(row)
        # Unmarked program directories remain untouched: a socket path alone
        # does not establish ownership of its parent.
        if not any(row['runningAfterHarness'] for row in endpoints):
            shutil.rmtree(self.directory)
        return dict(
            required=require_cleanup,
            endpoints=endpoints,
            passed=bool(endpoints) and all(
                (not row['preexisting'] or row['aliasOf'] in first) and
                not row['runningAfterHarness'] and
                row.get('directoryRetired', True) and
                (not require_cleanup or not row['runningAfterProgram'])
                for row in endpoints
            ),
            scope='Observed owned sockets after program exit, before harness retirement.',
        )
