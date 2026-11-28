"""Observe and retire only the tmux endpoints created by a native example.

The executable wrapper records explicit socket selections and then execs the
real tmux binary. It does not add setup code or change the copied program.

Run ``python3 scripts/example_tmux_sandbox.py --output-dir DIR
--require-capture -- PROGRAM ARGS`` to record raw stdio and a native witness.
The witness assumes a static owned pane and requires matching captures and
generation probes before and after the program's final capture.
"""

from __future__ import annotations

import argparse
import contextlib
import errno
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TypedDict


class SocketSelection(TypedDict):
    """The endpoint and prior ownership recorded by the tmux wrapper."""

    socket: str
    existed: bool
    aliasOf: str | None


def socket_running(path):
    """Report whether a server still accepts connections at this socket."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.2)
        try:
            client.connect(str(path))
        except OSError as error:
            if error.errno in (errno.ENOENT, errno.ECONNREFUSED):
                return False
            raise
        else:
            return True


def wait_for_socket_exit(path, seconds=2):
    """Wait for an observed server to stop accepting connections."""
    deadline = time.monotonic() + seconds
    while socket_running(path):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.01)
    return True


def stop_process_group(process):
    """Stop a timed-out command and descendants after its shell exits."""
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=5)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def native_capture_witness(stdout, captures):
    """Bind raw stdout to the final capture on one unchanged pane generation."""
    if not captures:
        msg = "No native capture was recorded"
        raise ValueError(msg)
    final = captures[-1]
    statuses = final.get("statuses", [])
    before = bytes.fromhex(final["beforeHex"])
    after = bytes.fromhex(final["afterHex"])
    generation = bytes.fromhex(final["generationBeforeHex"])
    parsed = re.fullmatch(rb"([1-9][0-9]*) ([0-9]+) (%[0-9]+)\n", generation)
    if (
        len(statuses) != 5
        or any(type(status) is not int or status != 0 for status in statuses)
        or parsed is None
        or generation != bytes.fromhex(final["generationAfterHex"])
        or parsed[3].decode("ascii") != final["pane"]
        or before != stdout
        or after != stdout
        or bytes.fromhex(final["libraryStdoutHex"]) != stdout
    ):
        msg = "Final native capture does not confirm the same pane and output bytes"
        raise ValueError(msg)
    return {
        "socket": final["socket"],
        "pane": final["pane"],
        "generation": {"pid": int(parsed[1]), "started": int(parsed[2])},
        "beforeHex": before.hex(),
        "afterHex": after.hex(),
    }


class ExampleTmuxSandbox:
    """Observe explicit tmux endpoints and retire only owned servers."""

    def __init__(self, output, env, *, forbid_tmux=False, record_captures=False):
        self.forbid_tmux = forbid_tmux
        binary = shutil.which("tmux", path=env["PATH"])
        if binary is None and not forbid_tmux:
            msg = "tmux is required to verify native examples"
            raise FileNotFoundError(msg)
        self.binary = str(Path(binary).resolve()) if binary else ""
        self.directory = Path(tempfile.mkdtemp(prefix="ltx-example-"))
        self.trace = output / "tmux-commands.jsonl"
        self.capture_trace = output / "native-captures.jsonl"
        bindir = output / "native-tools"
        bindir.mkdir()
        wrapper = bindir / "tmux"
        wrapper.write_text(f"""#!{sys.executable}
import json, os, re, subprocess, sys
from pathlib import Path

if {forbid_tmux!r}:
    descriptor = os.open({str(self.trace)!r}, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(descriptor, (json.dumps(sys.argv[1:]) + '\\n').encode())
    os.close(descriptor)
    sys.stderr.write('tmux is forbidden by this example execution profile\\n')
    raise SystemExit(125)
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
                            args=sys.argv[1:]))
    descriptor = os.open({str(self.trace)!r},
                         os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(descriptor, (entry + '\\n').encode())
    os.close(descriptor)
if {record_captures!r} and endpoint and args.count('capture-pane') == 1:
    capture = args[args.index('capture-pane') + 1:]
    if ';' in capture:
        capture = capture[:capture.index(';')]
    targets = [capture[index + 1] for index, value in enumerate(capture[:-1]) if value == '-t']
    if '-p' in capture and len(targets) == 1 and re.fullmatch(r'%[0-9]+', targets[0]):
        pane = targets[0]
        def native(arguments):
            return subprocess.run([{self.binary!r}, *arguments], capture_output=True,
                                  timeout=10, check=False)
        identity = ['-N', '-S', endpoint, 'display-message', '-p', '-t', pane,
                    '#{{pid}} #{{start_time}} #{{pane_id}}']
        snapshot = ['-N', '-S', endpoint, 'capture-pane', '-p', '-t', pane]
        generation_before = native(identity)
        before = native(snapshot)
        original = native(sys.argv[1:])
        after = native(snapshot)
        generation_after = native(identity)
        witness = dict(socket=endpoint, pane=pane,
                       statuses=[reply.returncode for reply in
                                 [generation_before, before, original, after, generation_after]],
                       generationBeforeHex=generation_before.stdout.hex(),
                       generationAfterHex=generation_after.stdout.hex(),
                       beforeHex=before.stdout.hex(), afterHex=after.stdout.hex(),
                       libraryStdoutHex=original.stdout.hex())
        descriptor = os.open({str(self.capture_trace)!r},
                             os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.write(descriptor, (json.dumps(witness) + '\\n').encode())
        os.close(descriptor)
        sys.stdout.buffer.write(original.stdout)
        sys.stdout.buffer.flush()
        sys.stderr.buffer.write(original.stderr)
        sys.stderr.buffer.flush()
        raise SystemExit(original.returncode)
os.execv({self.binary!r}, [{self.binary!r}, *sys.argv[1:]])
""")
        wrapper.chmod(0o700)
        self.env = dict(
            env,
            PATH=f"{bindir}{os.pathsep}{env['PATH']}",
            TMUX_TMPDIR=str(self.directory),
            TMUX_BIN=str(wrapper),
            LIBTMUX_TMUX=str(wrapper),
            LIBTMUX_NATIVE_TMUX=self.binary,
        )
        if record_captures:
            self.env["LIBTMUX_TEST_TMUX"] = str(wrapper)

    def finish(self, require_cleanup):
        """Record cleanup and stop only servers created by this example."""
        if self.forbid_tmux:
            invocations = self.trace.read_text().splitlines() if self.trace.exists() else []
            shutil.rmtree(self.directory)
            return {
                "required": False,
                "endpoints": [],
                "tmuxInvocations": len(invocations),
                "passed": not invocations,
                "scope": "Pure values profile: PATH tmux invocations are rejected before dispatch.",
            }
        first: dict[str, SocketSelection] = {}
        if self.trace.exists():
            for line in self.trace.read_text().splitlines():
                entry = json.loads(line)
                first.setdefault(entry["socket"], entry)
        endpoints = []
        for name, entry in first.items():
            path = Path(name)
            running = not wait_for_socket_exit(path) if require_cleanup else socket_running(path)
            row = {
                "socket": name,
                "preexisting": entry["existed"],
                "aliasOf": entry.get("aliasOf"),
                "runningAfterProgram": running,
            }
            # Never stop a server that existed before this example selected it.
            if not entry["existed"]:
                if running:
                    result = subprocess.run(
                        [self.binary, "-S", name, "kill-server"],
                        env=self.env,
                        capture_output=True,
                        text=True,
                        timeout=5,
                        check=False,
                    )
                    row["harnessStopExit"] = result.returncode
                    row["harnessStopStderr"] = result.stderr
                row["runningAfterHarness"] = not wait_for_socket_exit(path)
                if (
                    not row["runningAfterHarness"]
                    and path.exists()
                    and stat.S_ISSOCK(path.lstat().st_mode)
                ):
                    path.unlink(missing_ok=True)
            else:
                row["runningAfterHarness"] = running
            endpoints.append(row)
        # Only this directory was created by the harness. A program's socket
        # path alone does not establish ownership of its parent directory.
        if not any(row["runningAfterHarness"] for row in endpoints):
            shutil.rmtree(self.directory)
        return {
            "required": require_cleanup,
            "endpoints": endpoints,
            "passed": bool(endpoints)
            and all(
                (not row["preexisting"] or row["aliasOf"] in first)
                and not row["runningAfterHarness"]
                and (not require_cleanup or not row["runningAfterProgram"])
                for row in endpoints
            ),
            "scope": "Observed owned sockets after program exit, before harness retirement.",
        }


def main():
    """Record one native program and preserve its stdout and stderr bytes."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--require-capture", action="store_true")
    parser.add_argument("--record-captures", action="store_true")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.timeout <= 0:
        parser.error("a command and a positive timeout are required")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ)
    env.pop("TMUX", None)
    env.pop("TMUX_PANE", None)
    sandbox = ExampleTmuxSandbox(
        output,
        env,
        record_captures=args.require_capture or args.record_captures,
    )
    timed_out = False
    with (output / "stdout.bin").open("wb") as stdout, (output / "stderr.bin").open("wb") as stderr:
        try:
            process = subprocess.Popen(
                command,
                env=sandbox.env,
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,
            )
        except OSError as error:
            stderr.write(f"Could not start command: {type(error).__name__}\n".encode())
            status = 127
        else:
            try:
                status = process.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                stop_process_group(process)
                status = 124
    cleanup = sandbox.finish(True)
    stdout = (output / "stdout.bin").read_bytes()
    stderr = (output / "stderr.bin").read_bytes()
    captures = (
        [json.loads(line) for line in sandbox.capture_trace.read_text().splitlines()]
        if sandbox.capture_trace.exists()
        else []
    )
    witness = None
    failure = None
    if args.require_capture:
        try:
            witness = native_capture_witness(stdout, captures)
        except (KeyError, TypeError, ValueError) as error:
            failure = str(error)
    result = {
        "stdoutHex": stdout.hex(),
        "recorderSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "profile": "capture-stdout" if args.require_capture else "stdio",
        "status": status,
        "timedOut": timed_out,
        "cleanup": cleanup,
        "native": witness,
        "passed": status == 0 and cleanup["passed"] and failure is None,
    }
    if failure:
        result["failure"] = failure
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    sys.stdout.buffer.write(stdout)
    sys.stderr.buffer.write(stderr)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
