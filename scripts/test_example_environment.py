"""Live process-ownership checks for the external documentation runner."""

from __future__ import annotations

import ctypes
import errno
import fcntl
import json
import os
from pathlib import Path
import resource
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import example_environment as runner


RUNNER = Path(__file__).with_name("example_environment.py")


def observer_pidfd(pid):
    libc = ctypes.CDLL(None, use_errno=True)
    descriptor = libc.pidfd_open(pid, 0)
    if descriptor < 0:
        raise OSError(ctypes.get_errno(), "Cannot independently observe the fixture")
    return descriptor


class ChildDescriptorTests(unittest.TestCase):
    @staticmethod
    def exited(descriptor):
        poller = select.poll()
        poller.register(descriptor, select.POLLIN)
        return bool(poller.poll(0))

    def await_exit(self, child):
        deadline = time.monotonic() + 5
        while not child.poll():
            self.assertLess(time.monotonic(), deadline, "The accepted child did not exit")
            time.sleep(0.001)

    def start_blocked(self, *, popen=True):
        process = subprocess.Popen(
            [sys.executable, "-I", "-c", "import sys; sys.stdin.buffer.read(); sys.exit(17)"],
            stdin=subprocess.PIPE, env={"LC_ALL": "C"},
        )
        child = runner.Child(process.pid, "descriptor-test", process if popen else None)
        observer = observer_pidfd(process.pid)

        def finish():
            # This separate handle keeps test rescue bound to the accepted child.
            try:
                if not self.exited(observer):
                    runner.send_pidfd_signal(observer, signal.SIGKILL)
                if child.exit_observed:
                    process.returncode = child.exit_code
                process.wait(timeout=5)
            finally:
                process.stdin.close()
                os.close(observer)
                if child.descriptor is not None:
                    os.close(child.descriptor)
                    child.descriptor = None

        self.addCleanup(finish)
        return child, process, observer

    def test_high_pidfd_preserves_exit_status_signals_and_receipt_identity(self):
        for popen in (True, False):
            for terminate in (False, True):
                with self.subTest(popen=popen, terminate=terminate):
                    child, process, observer = self.start_blocked(popen=popen)
                    child.bind()
                    high = fcntl.fcntl(child.descriptor, fcntl.F_DUPFD_CLOEXEC, 1024)
                    os.close(child.descriptor)
                    child.descriptor = high
                    before = child.receipt()
                    self.assertGreaterEqual(high, 1024)
                    self.assertFalse(self.exited(observer))
                    self.assertFalse(child.poll())
                    self.assertEqual(before["identityBinding"], "pidfd")
                    self.assertIsInstance(before["startTicks"], int)
                    if terminate:
                        child.stop(signal.SIGTERM)
                    else:
                        process.stdin.close()
                    self.await_exit(child)
                    self.assertTrue(self.exited(observer))
                    self.assertIsNone(child.descriptor)
                    with self.assertRaises(OSError) as closed:
                        os.fstat(high)
                    self.assertEqual(closed.exception.errno, errno.EBADF)
                    after = child.receipt()
                    self.assertEqual(after["exitCode"], -signal.SIGTERM if terminate else 17)
                    self.assertEqual(after["signals"], [signal.SIGTERM] if terminate else [])
                    for key in ("pid", "role", "startTicks", "identityBinding", "bindingError"):
                        self.assertEqual(after[key], before[key])
                    with patch.object(runner, "send_pidfd_signal") as by_handle, patch.object(runner.os, "kill") as by_pid:
                        child.stop(signal.SIGTERM)
                        child.stop(signal.SIGKILL)
                        self.assertTrue(child.poll())
                        by_handle.assert_not_called()
                        by_pid.assert_not_called()
                    self.assertEqual(child.receipt(), after)

    def test_completed_children_release_descriptors_while_another_child_stays_live(self):
        live, process, observer = self.start_blocked()
        live.bind()
        live_descriptor = live.descriptor
        original_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
        limit = min(original_limit[0], 64)
        baseline = len(list(Path("/proc/self/fd").iterdir()))
        self.assertLess(baseline + 8, limit)
        accepted = []
        maximum = baseline
        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (limit, original_limit[1]))
            for index in range(limit * 2):
                pid = os.fork()
                if pid == 0:
                    os._exit(index % 20)
                child = runner.Child(pid, "completed-descriptor-test")
                accepted.append(child)
                child.bind()
                self.await_exit(child)
                maximum = max(maximum, len(list(Path("/proc/self/fd").iterdir())))
                self.assertEqual(child.exit_code, index % 20)
                self.assertEqual(child.receipt()["identityBinding"], "pidfd")
                self.assertLessEqual(maximum, baseline)
                self.assertFalse(live.poll())
                self.assertFalse(self.exited(observer))
                self.assertEqual(live.descriptor, live_descriptor)
                os.fstat(live_descriptor)
            self.assertTrue(all(child.exit_observed for child in accepted))
            self.assertTrue(all(child.descriptor is None for child in accepted))
            process.stdin.close()
            self.await_exit(live)
            self.assertEqual(live.exit_code, 17)
            self.assertTrue(self.exited(observer))
            print(f"Descriptor bound: {len(accepted)} completed children; fd baseline/max {baseline}/{maximum}; soft limit {limit}")
        finally:
            resource.setrlimit(resource.RLIMIT_NOFILE, original_limit)
            for child in accepted:
                if not child.exit_observed:
                    child.stop(signal.SIGKILL)
                    self.await_exit(child)
                if child.descriptor is not None:
                    os.close(child.descriptor)
                    child.descriptor = None

    def test_unreaped_child_fallback_retains_identity_after_exit(self):
        for popen in (True, False):
            with self.subTest(popen=popen):
                child, _, observer = self.start_blocked(popen=popen)
                with patch.object(runner, "open_pidfd", side_effect=OSError(errno.EMFILE, "injected pidfd exhaustion")):
                    with self.assertRaises(OSError):
                        child.bind()
                before = child.receipt()
                self.assertEqual(before["identityBinding"], "unreaped-child")
                self.assertEqual(before["bindingError"]["type"], "OSError")
                child.stop(signal.SIGTERM)
                self.await_exit(child)
                self.assertTrue(self.exited(observer))
                self.assertEqual(child.exit_code, -signal.SIGTERM)
                self.assertEqual(child.receipt()["identityBinding"], before["identityBinding"])
                self.assertEqual(child.receipt()["bindingError"], before["bindingError"])
                with patch.object(runner.os, "kill") as by_pid:
                    child.stop(signal.SIGKILL)
                    by_pid.assert_not_called()

    def test_invalid_descriptor_remains_an_observation_failure(self):
        child, _, observer = self.start_blocked()
        child.bind()
        os.close(child.descriptor)
        try:
            with self.assertRaises(OSError) as invalid:
                child.poll()
            self.assertEqual(invalid.exception.errno, errno.EBADF)
            self.assertFalse(child.exit_observed)
            self.assertFalse(self.exited(observer))
            self.assertEqual(child.receipt()["identityBinding"], "pidfd")
        finally:
            child.descriptor = None


class ExampleEnvironmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        destination = os.environ.get("EXAMPLE_ENVIRONMENT_TEST_OUTPUT")
        cls.artifacts = Path(destination) if destination else Path(tempfile.mkdtemp(prefix="example-runner-tests-"))
        if destination:
            cls.artifacts.mkdir(parents=True, exist_ok=False)
        cls.counter = 0
        print(f"Runner receipts: {cls.artifacts}", flush=True)

    def launch(self, code, *, mode="path", server_state="running", timeout=5, extra=(), ignore_sigchld=False):
        type(self).counter += 1
        output = self.artifacts / f"{self.counter:02}-{self._testMethodName}"
        env = dict(os.environ, TMUX="unusable-parent-endpoint,1,0", TMUX_PANE="%999999",
                   LIBTMUX_SOCKET_PATH="/unusable-parent-endpoint",
                   LIBTMUX_SOCKET_NAME="unusable-parent-name")
        process = subprocess.Popen(
            [sys.executable, str(RUNNER), "--output-dir", str(output),
             "--socket-mode", mode, "--timeout", str(timeout), *extra,
             "--server-state", server_state,
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

    def wait_example_ready(self, output):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                lines = (output / "example.log").read_text().splitlines()
                if lines:
                    return json.loads(lines[0])
                record = json.loads((output / "result.json").read_text())
                if record["state"] == "complete":
                    self.fail(f"Example did not reach its barrier: {record}")
            except OSError as error:
                if error.errno not in (errno.ENOENT, errno.ENODATA):
                    raise
            time.sleep(0.01)
        self.fail(f"No example barrier: {output}")

    @staticmethod
    def daemon_starting_program(exit_code=0):
        # This is a runner test: the child deliberately leaves its new daemon alive.
        return '''import json, os, pathlib, subprocess, time
root = pathlib.Path(os.environ["TMUX_TMPDIR"])
if "LIBTMUX_SOCKET_PATH" in os.environ:
    endpoint = pathlib.Path(os.environ["LIBTMUX_SOCKET_PATH"])
    selection = ["-S", str(endpoint)]
else:
    name = os.environ["LIBTMUX_SOCKET_NAME"]
    endpoint = root / f"tmux-{os.getuid()}" / name
    selection = ["-L", name]
assert not os.path.lexists(endpoint), "The runner prestarted a daemon"
subprocess.run(["tmux", *selection, "-f", "/dev/null", "new-session", "-d", "-s", "example", "sleep 60"], check=True)
pid = int(subprocess.check_output(["tmux", *selection, "display-message", "-p", "#{pid}"]))
print(json.dumps({"pid": pid, "root": str(root), "socket": str(endpoint)}), flush=True)
while not (root / "finish-example").exists():
    time.sleep(0.01)
subprocess.run(["tmux", *selection, "has-session", "-t", "=example"], check=True)
raise SystemExit(''' + str(exit_code) + ''')
'''

    def test_absent_daemon_is_started_by_the_example_and_retired_by_the_runner(self):
        before = dict(os.environ)
        for mode in ("path", "name"):
            for outcome in ("success", "body-failure", "timeout", "controller-crash"):
                with self.subTest(mode=mode, outcome=outcome):
                    process, output = self.launch(
                        self.daemon_starting_program(17 if outcome == "body-failure" else 0),
                        mode=mode, server_state="absent", timeout=1 if outcome == "timeout" else 5,
                    )
                    ready = self.wait_example_ready(output)
                    descriptor = observer_pidfd(ready["pid"])
                    try:
                        self.assertFalse(select.select([descriptor], [], [], 0)[0])
                        if outcome in ("success", "body-failure"):
                            (Path(ready["root"]) / "finish-example").touch()
                        elif outcome == "controller-crash":
                            process.kill()
                        process.communicate(timeout=15)
                        record = self.wait_record(output, "complete")
                        self.assertEqual(record["serverState"], "absent")
                        self.assertFalse(record["socketExistsBeforeExample"])
                        self.assertIsNone(record["daemonPid"])
                        self.assertFalse(any(child["role"] == "tmux-daemon" for child in record["processes"]))
                        daemon = next(child for child in record["processes"] if child["pid"] == ready["pid"])
                        self.assertEqual(daemon["role"], "adopted-descendant")
                        self.assertTrue(select.select([descriptor], [], [], 0)[0])
                        self.assertEqual(record["passed"], outcome == "success")
                        if outcome == "body-failure":
                            self.assertEqual(record["exampleExitCode"], 17)
                        elif outcome in ("timeout", "controller-crash"):
                            expected = "TimeoutError" if outcome == "timeout" else "InterruptedError"
                            self.assertEqual(record["errors"][0]["type"], expected)
                        self.cleaned(record)
                    finally:
                        os.close(descriptor)
        self.assertEqual(dict(os.environ), before)

    def test_parallel_absent_daemon_runs_keep_the_other_daemon_alive(self):
        runs = []
        try:
            for mode in ("path", "name"):
                process, output = self.launch(self.daemon_starting_program(), mode=mode,
                                              server_state="absent", timeout=10)
                ready = self.wait_example_ready(output)
                runs.append((process, output, ready, observer_pidfd(ready["pid"])))
            self.assertNotEqual(runs[0][2]["pid"], runs[1][2]["pid"])
            self.assertNotEqual(runs[0][2]["root"], runs[1][2]["root"])
            self.assertNotEqual(runs[0][2]["socket"], runs[1][2]["socket"])
            for index, (process, output, ready, descriptor) in enumerate(runs):
                (Path(ready["root"]) / "finish-example").touch()
                process.communicate(timeout=15)
                record = self.wait_record(output, "complete")
                self.assertTrue(record["passed"], record)
                self.assertTrue(select.select([descriptor], [], [], 0)[0])
                self.cleaned(record)
                if index == 0:
                    self.assertFalse(select.select([runs[1][3]], [], [], 0)[0])
                    self.assertTrue(Path(runs[1][2]["socket"]).exists())
        finally:
            for process, _, _, descriptor in runs:
                self.finish_controller(process)
                os.close(descriptor)

    def test_absent_mode_does_not_require_the_example_to_start_tmux(self):
        process, output = self.launch("print('no tmux operation')", server_state="absent")
        process.communicate(timeout=15)
        record = self.wait_record(output, "complete")
        self.assertTrue(record["passed"], record)
        self.assertFalse(record["socketExistsBeforeExample"])
        self.assertEqual([child["role"] for child in record["processes"]], ["example"])
        self.cleaned(record)

    def test_daemon_exit_is_reaped_while_the_example_is_still_running(self):
        code = '''import os, subprocess, time
selection = ["-S", os.environ["LIBTMUX_SOCKET_PATH"]]
subprocess.run(["tmux", *selection, "-f", "/dev/null", "new-session", "-d", "-s", "example", "sleep 60"], check=True)
pid = int(subprocess.check_output(["tmux", *selection, "display-message", "-p", "#{pid}"]))
subprocess.run(["tmux", *selection, "kill-server"], check=True)
deadline = time.monotonic() + 1
while True:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        break
    if time.monotonic() >= deadline:
        raise AssertionError("The runner left the stopped daemon as a zombie while the example was alive")
    time.sleep(0.01)
print(pid)
'''
        for state in ("absent", "running"):
            with self.subTest(state=state):
                process, output = self.launch(code, server_state=state)
                process.communicate(timeout=15)
                record = self.wait_record(output, "complete")
                self.assertTrue(record["passed"], (record, (output / "example.log").read_text()))
                daemon_pid = int((output / "example.log").read_text())
                daemon = next(child for child in record["processes"] if child["pid"] == daemon_pid)
                worker = next(child for child in record["processes"] if child["role"] == "example")
                self.assertFalse(daemon["signals"])
                self.assertLess(daemon["exitObservedAt"], worker["exitObservedAt"])
                self.cleaned(record)

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
