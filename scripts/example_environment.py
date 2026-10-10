#!/usr/bin/env python3
"""Run an unchanged example with child-only tmux defaults on Linux.

A separate supervisor reaps orphaned descendants, including daemons started by
the example. It can also start a foreground daemon before the example runs.
Closing the controller pipe, including after a controller crash, requests cleanup.
The output directory retains the result and logs; only the supervisor's private
socket directory is removed, after every accepted child has exited.
"""

from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import select
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def open_pidfd(pid: int) -> int:
    """Use libc when Python was built without the Linux pidfd declarations."""
    if hasattr(os, "pidfd_open"):
        return os.pidfd_open(pid)
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.pidfd_open
    call.argtypes = [ctypes.c_int, ctypes.c_uint]
    call.restype = ctypes.c_int
    descriptor = call(pid, 0)
    if descriptor < 0:
        raise OSError(ctypes.get_errno(), "Cannot open a process descriptor")
    return descriptor


def send_pidfd_signal(descriptor: int, number: int) -> None:
    if hasattr(signal, "pidfd_send_signal"):
        signal.pidfd_send_signal(descriptor, number)
        return
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.pidfd_send_signal
    call.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    if call(descriptor, number, None, 0) < 0:
        raise OSError(ctypes.get_errno(), "Cannot signal the accepted process descriptor")


def check_pidfd_support() -> None:
    descriptor = open_pidfd(os.getpid())
    try:
        send_pidfd_signal(descriptor, 0)
    finally:
        os.close(descriptor)


def save_json(path: Path, value: object) -> None:
    """Publish a complete receipt without exposing a partially written JSON file."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@dataclass
class Child:
    """A direct child bound by its unreaped PID, with an optional pidfd."""

    pid: int
    role: str
    process: subprocess.Popen | None = None
    descriptor: int | None = field(default=None, init=False)
    start_ticks: int | None = field(default=None, init=False)
    binding_error: dict | None = field(default=None, init=False)
    exit_code: int | None = None
    exit_observed: bool = False
    signals: list[int] = field(default_factory=list)
    exit_observed_at: float | None = None

    def bind(self) -> None:
        try:
            self.descriptor = open_pidfd(self.pid)
            # An unreaped child cannot be replaced by another process at this PID.
            self.start_ticks = int(Path(f"/proc/{self.pid}/stat").read_text().rsplit(")", 1)[1].split()[19])
        except BaseException as error:
            self.binding_error = dict(type=type(error).__name__, message=str(error))
            raise

    def poll(self) -> bool:
        if self.exit_observed:
            return True
        if self.descriptor is not None:
            readable, _, _ = select.select([self.descriptor], [], [], 0)
            if not readable:
                return False
        if self.process is not None:
            code = self.process.poll()
            if code is None:
                return False
        else:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid == 0:
                return False
            code = os.waitstatus_to_exitcode(status)
        self.exit_code = code
        self.exit_observed = True
        self.exit_observed_at = time.monotonic()
        return True

    def stop(self, number: int) -> None:
        if self.poll() or number in self.signals:
            return
        try:
            if self.descriptor is not None:
                send_pidfd_signal(self.descriptor, number)
            else:
                # SIGCHLD is reset before spawning; only this thread reaps children.
                # poll() above therefore keeps this live PID bound until we reap it.
                os.kill(self.pid, number)
            self.signals.append(number)
        except ProcessLookupError:
            self.poll()

    def receipt(self) -> dict:
        return dict(pid=self.pid, role=self.role, startTicks=self.start_ticks,
                    identityBinding="pidfd" if self.descriptor is not None else "unreaped-child",
                    bindingError=self.binding_error,
                    exitCode=self.exit_code, exitObserved=self.exit_observed,
                    exitObservedAt=self.exit_observed_at, signals=self.signals)


class Supervisor:
    """Own one invocation, with cleanup independent of its controlling process."""

    def __init__(self, config: dict, output: Path) -> None:
        self.config = config
        self.output = output
        self.children: list[Child] = []
        self.root: Path | None = None
        self.root_identity: tuple[int, int] | None = None
        self.interrupted = False
        self.record = dict(schema=1, runId=config["runId"], state="starting",
                           command=config["command"], cwd=config["cwd"],
                           supervisorPid=os.getpid(), controllerPid=os.getppid(),
                           socketMode=config["socketMode"],
                           serverState=config.get("serverState", "running"),
                           errors=[], passed=False)

    def save(self) -> None:
        self.record["processes"] = [child.receipt() for child in self.children]
        save_json(self.output / "result.json", self.record)

    def start(self, args: list[str], role: str, stream, env: dict[str, str]) -> Child:
        process = subprocess.Popen(args, cwd=self.config["cwd"], env=env,
                                   stdin=subprocess.DEVNULL, stdout=stream,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        child = Child(process.pid, role, process)
        self.children.append(child)
        child.bind()
        self.save()
        return child

    def cancelled(self) -> bool:
        if self.interrupted:
            return True
        readable, _, _ = select.select([sys.stdin.fileno()], [], [], 0)
        if readable:
            # EOF means the controller exited; any written byte is cancellation.
            os.read(sys.stdin.fileno(), 4096)
            self.interrupted = True
        return self.interrupted

    def cleanup_error(self, error: BaseException) -> None:
        detail = dict(phase="cleanup", type=type(error).__name__, message=str(error))
        if detail not in self.record["errors"]:
            self.record["errors"].append(detail)

    def adopt_orphans(self) -> list[int] | None:
        path = Path(f"/proc/self/task/{os.getpid()}/children")
        try:
            pids = [int(value) for value in path.read_text().split()]
        except OSError as error:
            self.cleanup_error(error)
            return None
        known = {child.pid for child in self.children if not child.exit_observed}
        for pid in pids:
            if pid not in known:
                child = Child(pid, "adopted-descendant")
                self.children.append(child)
                try:
                    child.bind()
                except BaseException as error:
                    self.cleanup_error(error)
        return pids

    def cleanup(self) -> None:
        self.record["state"] = "cleaning"
        try:
            self.save()
        except OSError as error:
            # A full log volume must not prevent termination of owned children.
            self.record["errors"].append(dict(phase="receipt", type=type(error).__name__, message=str(error)))
        started = time.monotonic()
        deadline = started + self.config["cleanupTimeout"]
        while True:
            self.adopt_orphans()
            number = signal.SIGKILL if time.monotonic() - started >= 0.5 else signal.SIGTERM
            for child in self.children:
                try:
                    child.stop(number)
                except BaseException as error:
                    self.cleanup_error(error)
            # A reaped parent may have just transferred its children to us.
            pids = self.adopt_orphans()
            observed = []
            for child in self.children:
                try:
                    observed.append(child.poll())
                except BaseException as error:
                    self.cleanup_error(error)
                    observed.append(False)
            if pids == [] and all(observed):
                break
            if time.monotonic() >= deadline:
                raise TimeoutError("Child exit was not observed; the socket directory is retained")
            time.sleep(0.02)
        self.record["allChildExitsObserved"] = True
        if self.root is not None:
            current = self.root.lstat()
            if (current.st_dev, current.st_ino) != self.root_identity or self.root.is_symlink():
                raise RuntimeError("The private directory identity changed; it is retained")
            shutil.rmtree(self.root)
            self.record["rootRemoved"] = True
            self.record["rootRemovedAt"] = time.monotonic()

    def run(self) -> int:
        self.save()
        try:
            # Inherited SIG_IGN auto-reaps children and loses their real exit status.
            signal.signal(signal.SIGCHLD, signal.SIG_DFL)
            # Check both bindings before creating a directory or starting tmux.
            check_pidfd_support()
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
                raise OSError(ctypes.get_errno(), "Cannot supervise orphaned example processes")
            os.umask(0o077)
            self.root = Path(tempfile.mkdtemp(prefix="libtmux-example-"))
            identity = self.root.lstat()
            self.root_identity = (identity.st_dev, identity.st_ino)
            env = dict(os.environ)
            for name in ("TMUX", "TMUX_PANE", "LIBTMUX_SOCKET_PATH", "LIBTMUX_SOCKET_NAME"):
                env.pop(name, None)
            env["TMUX_TMPDIR"] = str(self.root)
            env["TMUX_BIN"] = env["LIBTMUX_TMUX"] = self.config["tmux"]
            bindir = self.root / "bin"
            bindir.mkdir()
            (bindir / "tmux").symlink_to(self.config["tmux"])
            env["PATH"] = str(bindir) + os.pathsep + env.get("PATH", os.defpath)
            if self.config["socketMode"] == "path":
                socket_path = self.root / "server"
                env["LIBTMUX_SOCKET_PATH"] = str(socket_path)
            else:
                directory = self.root / f"tmux-{os.getuid()}"
                directory.mkdir(mode=0o700)
                socket_path = directory / "example"
                env["LIBTMUX_SOCKET_NAME"] = "example"
            self.record.update(root=str(self.root), socket=str(socket_path),
                               environmentKeys=["TMUX_TMPDIR", "TMUX_BIN", "LIBTMUX_TMUX",
                                                "LIBTMUX_SOCKET_" + self.config["socketMode"].upper()])
            with (self.output / "tmux.log").open("wb") as tmux_log:
                daemon = None
                if self.record["serverState"] == "running":
                    daemon = self.start([self.config["tmux"], "-D", "-f", "/dev/null", "-S", str(socket_path)],
                                        "tmux-daemon", tmux_log, env)
                    deadline = time.monotonic() + self.config["startupTimeout"]
                    while not socket_path.exists():
                        if self.cancelled():
                            raise InterruptedError("Controller interrupted during fixture startup")
                        if daemon.poll():
                            raise RuntimeError("The foreground tmux daemon exited during startup; see tmux.log")
                        if time.monotonic() >= deadline:
                            raise TimeoutError("The foreground tmux daemon did not publish its socket")
                        time.sleep(0.01)
                elif self.record["serverState"] != "absent":
                    raise ValueError("serverState must be absent or running")
                # Record the condition before starting the unchanged example.
                # lexists also rejects a dangling replacement at the private endpoint.
                self.record["socketExistsBeforeExample"] = os.path.lexists(socket_path)
                if daemon is None and self.record["socketExistsBeforeExample"]:
                    raise RuntimeError("The no-daemon endpoint is occupied before the example starts")
                with (self.output / "example.log").open("wb") as example_log:
                    worker = self.start(self.config["command"], "example", example_log, env)
                    self.record.update(state="running", examplePid=worker.pid,
                                       daemonPid=daemon.pid if daemon is not None else None)
                    self.save()
                    deadline = time.monotonic() + self.config["timeout"]
                    while not worker.poll():
                        self.adopt_orphans()
                        # Reap completed children without stopping live ones. A
                        # library may wait for its closed daemon's PID to vanish.
                        for child in self.children:
                            if child is not worker:
                                child.poll()
                        if self.cancelled():
                            raise InterruptedError("The controller exited or requested cancellation")
                        if time.monotonic() >= deadline:
                            raise TimeoutError("The example exceeded its execution timeout")
                        time.sleep(0.01)
                    self.record["exampleExitCode"] = worker.exit_code
                    if worker.exit_code != 0:
                        raise RuntimeError(f"The example exited with status {worker.exit_code}; see example.log")
                    self.record["bodyPassed"] = True
        except BaseException as error:
            self.record["errors"].append(dict(phase="body", type=type(error).__name__, message=str(error)))
        finally:
            try:
                self.cleanup()
            except BaseException as error:
                self.record["errors"].append(dict(phase="cleanup", type=type(error).__name__, message=str(error)))
            self.record["passed"] = self.record.get("bodyPassed", False) and not self.record["errors"]
            self.record["state"] = "complete"
            try:
                self.save()
            except OSError:
                self.record["passed"] = False
            finally:
                for child in self.children:
                    if child.descriptor is not None:
                        os.close(child.descriptor)
        return 0 if self.record["passed"] else 1


def positive_seconds(value: str) -> float:
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise argparse.ArgumentTypeError("Timeouts must be finite positive seconds")
    return seconds


def main() -> int:
    # The controller also needs the supervisor's actual wait status.
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    if len(sys.argv) == 3 and sys.argv[1] == "--supervise":
        output = Path(sys.argv[2])
        supervisor = Supervisor(json.loads((output / "invocation.json").read_text()), output)

        def cancel(number, frame):
            supervisor.interrupted = True

        signal.signal(signal.SIGINT, cancel)
        signal.signal(signal.SIGTERM, cancel)
        return supervisor.run()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path, help="New directory for logs and the result receipt")
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    parser.add_argument("--socket-mode", choices=("path", "name"), default="path")
    parser.add_argument("--server-state", choices=("absent", "running"), default="running",
                        help="Start with no daemon, or prestart a fixture daemon (default: running)")
    parser.add_argument("--timeout", type=positive_seconds, default=30.0)
    parser.add_argument("--startup-timeout", type=positive_seconds, default=5.0)
    parser.add_argument("--cleanup-timeout", type=positive_seconds, default=5.0)
    parser.add_argument("--tmux", default="tmux")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("Supply an example command after --")
    if not sys.platform.startswith("linux"):
        parser.error("The external runner requires Linux with pidfd support")
    try:
        check_pidfd_support()
    except (AttributeError, OSError) as error:
        parser.error(f"Linux pidfd operations are unavailable: {error}")
    binary = shutil.which(args.tmux)
    if binary is None:
        parser.error(f"Cannot find the tmux executable: {args.tmux}")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    config = dict(runId=secrets.token_hex(16), command=command, cwd=str(args.cwd.resolve()),
                  tmux=str(Path(binary).resolve()), socketMode=args.socket_mode,
                  serverState=args.server_state,
                  timeout=args.timeout, startupTimeout=args.startup_timeout,
                  cleanupTimeout=args.cleanup_timeout)
    save_json(output / "invocation.json", config)
    with (output / "supervisor.log").open("wb") as stream:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--supervise", str(output)],
                                   stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            return process.wait()
        except KeyboardInterrupt:
            return 130
        finally:
            process.stdin.close()
            # Do not kill the supervisor: it must finish observing owned exits.
            process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
