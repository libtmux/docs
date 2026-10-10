"""Live process-ownership checks for the external documentation runner."""

from __future__ import annotations

import ctypes
import errno
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


RUNNER = Path(__file__).with_name("example_environment.py")


def observer_pidfd(pid):
    libc = ctypes.CDLL(None, use_errno=True)
    descriptor = libc.pidfd_open(pid, 0)
    if descriptor < 0:
        raise OSError(ctypes.get_errno(), "Cannot independently observe the fixture")
    return descriptor


class ExampleEnvironmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        destination = os.environ.get("EXAMPLE_ENVIRONMENT_TEST_OUTPUT")
        cls.artifacts = Path(destination) if destination else Path(tempfile.mkdtemp(prefix="example-runner-tests-"))
        if destination:
            cls.artifacts.mkdir(parents=True, exist_ok=False)
        cls.counter = 0
        print(f"Runner receipts: {cls.artifacts}", flush=True)

    def launch(self, code, *, mode="path", timeout=5, extra=(), ignore_sigchld=False):
        type(self).counter += 1
        output = self.artifacts / f"{self.counter:02}-{self._testMethodName}"
        env = dict(os.environ, TMUX="unusable-parent-endpoint,1,0", TMUX_PANE="%999999",
                   LIBTMUX_SOCKET_PATH="/unusable-parent-endpoint",
                   LIBTMUX_SOCKET_NAME="unusable-parent-name")
        process = subprocess.Popen(
            [sys.executable, str(RUNNER), "--output-dir", str(output),
             "--socket-mode", mode, "--timeout", str(timeout), *extra,
             "--", sys.executable, "-c", code], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            preexec_fn=(lambda: signal.signal(signal.SIGCHLD, signal.SIG_IGN)) if ignore_sigchld else None,
        )
        self.addCleanup(self.finish_controller, process)
        return process, output

    @staticmethod
    def finish_controller(process):
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=15)

    def wait_record(self, output, state):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                record = json.loads((output / "result.json").read_text())
                if record["state"] == state:
                    return record
                if record["state"] == "complete":
                    self.fail(f"Expected {state}: {record}")
            except OSError as error:
                # DrvFS may briefly report ENODATA while an atomic receipt is replaced.
                if error.errno not in (errno.ENOENT, errno.ENODATA):
                    raise
            time.sleep(0.01)
        self.fail(f"No {state} receipt: {output}")

    def cleaned(self, record):
        self.assertTrue(record["allChildExitsObserved"], record)
        self.assertTrue(record["rootRemoved"], record)
        self.assertFalse(Path(record["root"]).exists())
        self.assertTrue(record["processes"])
        for process in record["processes"]:
            self.assertTrue(process["exitObserved"], process)
            self.assertIsNotNone(process["exitCode"])
            self.assertLessEqual(process["exitObservedAt"], record["rootRemovedAt"])

    def test_defaults_are_child_only_and_select_the_owned_daemon(self):
        before = dict(os.environ)
        code = '''import json, os, subprocess
assert "TMUX" not in os.environ and "TMUX_PANE" not in os.environ
if "LIBTMUX_SOCKET_PATH" in os.environ:
    assert "LIBTMUX_SOCKET_NAME" not in os.environ
    selection = ["-S", os.environ["LIBTMUX_SOCKET_PATH"]]
else:
    assert os.environ["LIBTMUX_SOCKET_NAME"] == "example"
    selection = ["-L", os.environ["LIBTMUX_SOCKET_NAME"]]
pid = subprocess.check_output(["tmux", *selection, "display-message", "-p", "#{pid}"], text=True)
print(json.dumps({"pid": int(pid)}))
'''
        for mode in ("path", "name"):
            with self.subTest(mode=mode):
                process, output = self.launch(code, mode=mode)
                stdout, _ = process.communicate(timeout=15)
                self.assertEqual(process.returncode, 0, stdout)
                record = self.wait_record(output, "complete")
                self.assertTrue(record["passed"])
                self.assertEqual(json.loads((output / "example.log").read_text())["pid"], record["daemonPid"])
                self.cleaned(record)
        self.assertEqual(dict(os.environ), before)

    def test_body_failure_keeps_its_status_and_reaps_orphaned_descendants(self):
        code = '''import subprocess, sys
child = subprocess.Popen([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)"], start_new_session=True, stdout=subprocess.PIPE)
assert child.stdout.readline() == b"ready\\n"
raise SystemExit(17)
'''
        process, output = self.launch(code)
        process.communicate(timeout=15)
        record = self.wait_record(output, "complete")
        self.assertEqual(process.returncode, 1)
        self.assertEqual(record["exampleExitCode"], 17)
        descendants = [child for child in record["processes"] if child["role"] == "adopted-descendant"]
        self.assertTrue(descendants)
        self.assertTrue(any(signal.SIGKILL in child["signals"] for child in descendants))
        self.cleaned(record)

    def test_timeout_observes_daemon_exit_before_removal(self):
        process, output = self.launch("import time; time.sleep(60)", timeout=0.4)
        running = self.wait_record(output, "running")
        descriptor = observer_pidfd(running["daemonPid"])
        try:
            self.assertTrue(Path(running["root"]).exists())
            self.assertFalse(select.select([descriptor], [], [], 0)[0])
            process.communicate(timeout=15)
            record = self.wait_record(output, "complete")
            self.assertTrue(select.select([descriptor], [], [], 0)[0])
            self.assertEqual(record["errors"][0]["type"], "TimeoutError")
            self.cleaned(record)
        finally:
            os.close(descriptor)

    def test_controller_interruption_and_crash_request_cleanup(self):
        for number in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
            with self.subTest(signal=number):
                process, output = self.launch("import time; time.sleep(60)")
                running = self.wait_record(output, "running")
                descriptor = observer_pidfd(running["daemonPid"])
                try:
                    process.send_signal(number)
                    process.communicate(timeout=15)
                    record = self.wait_record(output, "complete")
                    self.assertTrue(select.select([descriptor], [], [], 0)[0])
                    self.assertFalse(record["passed"])
                    self.assertEqual(record["errors"][0]["type"], "InterruptedError")
                    self.cleaned(record)
                finally:
                    os.close(descriptor)

    def test_crashed_example_is_failure_even_when_cleanup_succeeds(self):
        process, output = self.launch("import os, signal; os.kill(os.getpid(), signal.SIGKILL)")
        process.communicate(timeout=15)
        record = self.wait_record(output, "complete")
        self.assertFalse(record["passed"])
        self.assertEqual(record["exampleExitCode"], -signal.SIGKILL)
        self.cleaned(record)

    def test_inherited_ignored_sigchld_preserves_failure_status(self):
        process, output = self.launch("raise SystemExit(17)", ignore_sigchld=True)
        process.communicate(timeout=15)
        record = self.wait_record(output, "complete")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(record["passed"])
        self.assertEqual(record["exampleExitCode"], 17)
        self.cleaned(record)

    def test_cleanup_error_does_not_replace_the_body_error(self):
        output = self.artifacts / "paired-failure"
        output.mkdir()
        config = dict(runId="paired-failure", command=[sys.executable, "-c", "raise SystemExit(19)"],
                      cwd=str(output), tmux=shutil.which("tmux"),
                      socketMode="path", timeout=5, startupTimeout=5, cleanupTimeout=5)
        (output / "invocation.json").write_text(json.dumps(config))
        code = '''import importlib.util, pathlib, sys
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("example_environment", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
sys.argv = [sys.argv[1], "--supervise", sys.argv[2]]
with patch.object(module.shutil, "rmtree", side_effect=PermissionError("injected removal failure")):
    raise SystemExit(module.main())
'''
        process = subprocess.Popen([sys.executable, "-c", code, str(RUNNER), str(output)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            self.assertEqual(process.wait(timeout=15), 1)
            record = self.wait_record(output, "complete")
            self.assertEqual(record["exampleExitCode"], 19)
            self.assertEqual([error["phase"] for error in record["errors"]], ["body", "cleanup"])
            self.assertTrue(record["allChildExitsObserved"])
            root = Path(record["root"])
            self.assertTrue(root.is_dir())
            # The failed operation left only this invocation's known, exited fixture.
            shutil.rmtree(root)
            (output / "test-cleanup.json").write_text(json.dumps({"root": str(root), "removedAfterObservedExits": True}))
        finally:
            process.stdin.close()
            process.stdin = None
            process.communicate(timeout=15)

    def test_existing_output_is_not_reused_as_a_new_receipt(self):
        process, output = self.launch("print('first run')")
        process.communicate(timeout=15)
        before = (output / "result.json").read_bytes()
        repeat = subprocess.run([sys.executable, str(RUNNER), "--output-dir", str(output),
                                 "--", sys.executable, "-c", "raise SystemExit(0)"], capture_output=True)
        self.assertNotEqual(repeat.returncode, 0)
        self.assertEqual((output / "result.json").read_bytes(), before)

    def test_receipt_write_failure_still_stops_accepted_children(self):
        output = self.artifacts / "receipt-write-failure"
        output.mkdir()
        config = dict(runId="receipt-write-failure", command=[sys.executable, "-c", "pass"],
                      cwd=str(output), tmux=shutil.which("tmux"), socketMode="path",
                      timeout=5, startupTimeout=5, cleanupTimeout=5)
        (output / "invocation.json").write_text(json.dumps(config))
        code = '''import ctypes, errno, importlib.util, json, os, pathlib, select, shutil, signal, sys
spec = importlib.util.spec_from_file_location("example_environment", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
output = pathlib.Path(sys.argv[2])
observer = None
class FullVolume(module.Supervisor):
    def save(self):
        global observer
        if self.children:
            if observer is None:
                observer = ctypes.CDLL(None).pidfd_open(self.children[0].pid, 0)
                if observer < 0:
                    raise RuntimeError("Independent observer could not bind the child")
            raise OSError(errno.ENOSPC, "injected full receipt volume")
        super().save()
supervisor = FullVolume(json.loads((output / "invocation.json").read_text()), output)
result = supervisor.run()
observed = bool(select.select([observer], [], [], 0)[0])
removed = not supervisor.root.exists()
rescued = False
try:
    if not observed:
        rescued = True
        module.send_pidfd_signal(observer, signal.SIGKILL)
        if not select.select([observer], [], [], 5)[0]:
            raise RuntimeError("Known child did not exit during test rescue")
    if supervisor.root.exists():
        shutil.rmtree(supervisor.root)
finally:
    os.close(observer)
(output / "observer.json").write_text(json.dumps({"result": result, "exitObserved": observed, "rootRemovedBeforeRescue": removed, "rescueRequired": rescued, "root": str(supervisor.root)}))
if result != 1 or not observed or not removed or rescued:
    raise SystemExit(1)
'''
        result = subprocess.run([sys.executable, "-B", "-c", code, str(RUNNER), str(output)],
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        observation = json.loads((output / "observer.json").read_text())
        self.assertTrue(observation["exitObserved"])
        self.assertTrue(observation["rootRemovedBeforeRescue"])
        self.assertFalse(observation["rescueRequired"])

    def test_process_binding_and_inventory_failures_keep_cleanup_scoped(self):
        code = '''import ctypes, errno, importlib.util, json, os, pathlib, select, signal, sys
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("example_environment", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
output = pathlib.Path(sys.argv[2])
role = sys.argv[3]
observed = {}
original_bind = module.Child.bind
original_read = module.Path.read_text
def read(path, *args, **kwargs):
    if role == "inventory" and str(path).startswith("/proc/self/task/") and path.name == "children":
        raise PermissionError("injected child inventory failure")
    return original_read(path, *args, **kwargs)
def bind(child):
    descriptor = ctypes.CDLL(None).pidfd_open(child.pid, 0)
    if descriptor < 0:
        raise RuntimeError("Independent observer could not bind the child")
    observed[child.pid] = descriptor
    if child.role == role:
        with patch.object(module, "open_pidfd", side_effect=OSError(errno.EMFILE, "injected pidfd exhaustion")):
            return original_bind(child)
    return original_bind(child)
read_pipe, write_pipe = os.pipe()
os.dup2(read_pipe, 0)
os.close(read_pipe)
supervisor = module.Supervisor(json.loads((output / "invocation.json").read_text()), output)
with patch.object(module.Child, "bind", bind), patch.object(module.Path, "read_text", read):
    result = supervisor.run()
exits = {str(pid): bool(select.select([descriptor], [], [], 0)[0]) for pid, descriptor in observed.items()}
remaining = pathlib.Path(f"/proc/self/task/{os.getpid()}/children").read_text().split()
removed = not supervisor.root.exists()
rescue = []
try:
    for pid, descriptor in observed.items():
        if not exits[str(pid)]:
            rescue.append(pid)
            module.send_pidfd_signal(descriptor, signal.SIGKILL)
            if not select.select([descriptor], [], [], 5)[0]:
                raise RuntimeError("Known child did not exit during test rescue")
    if supervisor.root.exists() and all(exits.values()) and not remaining:
        module.shutil.rmtree(supervisor.root)
finally:
    for descriptor in observed.values():
        os.close(descriptor)
    os.close(write_pipe)
(output / "observer.json").write_text(json.dumps({"result": result, "exitObservations": exits, "remainingChildren": remaining, "rootRemovedBeforeRescue": removed, "rescueRequired": rescue}))
if result != 1 or not all(exits.values()) or removed != (role != "inventory") or rescue or remaining:
    raise SystemExit(1)
'''
        for role in ("tmux-daemon", "example", "adopted-descendant", "inventory"):
            with self.subTest(role=role):
                output = self.artifacts / ("pidfd-failure-" + role)
                output.mkdir()
                worker = "import time; time.sleep(60)"
                if role == "adopted-descendant":
                    worker = "import subprocess,sys; subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'])"
                elif role == "inventory":
                    worker = "raise SystemExit(19)"
                config = dict(runId="pidfd-failure-" + role, command=[sys.executable, "-c", worker],
                              cwd=str(output), tmux=shutil.which("tmux"), socketMode="path",
                              timeout=5, startupTimeout=5, cleanupTimeout=0.3 if role == "inventory" else 5)
                (output / "invocation.json").write_text(json.dumps(config))
                result = subprocess.run([sys.executable, "-B", "-c", code, str(RUNNER), str(output), role],
                                        capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                record = self.wait_record(output, "complete")
                self.assertFalse(record["passed"])
                if role == "inventory":
                    self.assertFalse(record.get("allChildExitsObserved", False))
                    self.assertFalse(record.get("rootRemoved", False))
                    self.assertTrue(all(child["exitObserved"] for child in record["processes"]))
                    self.assertTrue(any(error["type"] == "PermissionError" for error in record["errors"]))
                    self.assertTrue(any(error["type"] == "TimeoutError" for error in record["errors"]))
                    continue
                self.assertTrue(any(child["role"] == role and child["identityBinding"] == "unreaped-child"
                                    and child["bindingError"] for child in record["processes"]))
                self.cleaned(record)


if __name__ == "__main__":
    unittest.main()
