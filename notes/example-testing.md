# Run ordinary examples with external tmux defaults

[`scripts/example_environment.py`](../scripts/example_environment.py) runs a command with child-only endpoint defaults and external process cleanup. The example keeps its imports and ordinary public server API. The selected port must support `LIBTMUX_SOCKET_PATH` and `LIBTMUX_SOCKET_NAME` for those defaults to take effect.

The commands below assume the example files and their dependencies exist in the working directory. Use `--cwd` to select a port checkout. This invocation runs Python's session-cleanup demonstration without changing its source:

```console
$ python3 scripts/example_environment.py \
    --output-dir /tmp/session-example-result \
    -- python3 examples/session_scope.py
```

The output directory must be new. `example.log` contains the example's output, `tmux.log` contains daemon diagnostics, and `result.json` records the command, process identities, exit observations and cleanup outcome. The runner returns zero only when the command succeeds and cleanup completes. It does not install dependencies or choose a library version; activate the intended runtime and library before running it.

The socket directory follows Python's `TMPDIR` selection and must reside on a filesystem that supports Unix sockets. The output directory can be on a different volume. Failure to write a receipt still triggers owned-process cleanup and makes the invocation fail.

## Choose the initial server state

Use `--server-state absent` to begin with no daemon at the private endpoint. The example's public API must start tmux if its operations need a server. The runner sets the environment, checks that the endpoint is absent, and launches the unchanged program. It adopts orphaned descendants for cleanup, including a daemon started by that program. A program that does not need tmux may finish without starting it.

The default, `--server-state running`, starts a foreground fixture daemon before the program runs. This mode supports examples and native tests that require an existing server. Run ordinary examples under both initial conditions to check startup and reuse; a passing prestarted fixture cannot establish the startup case. Neither mode requires cleanup statements in the example. Keep cleanup helpers in examples that teach those helpers.

`result.json` records `serverState` and `socketExistsBeforeExample`. `daemonPid` identifies a fixture that the runner started and is null in absent mode. The `processes` array includes accepted descendants and their exit observations. In absent mode, the program's own tmux diagnostics go to `example.log`; the runner's `tmux.log` remains empty.

Each invocation creates its own endpoint directory. Parallel invocations can reuse the same example source and named-socket default without sharing a daemon. Use a separate output directory for each invocation, and exercise both initial conditions with both socket selectors.

## Endpoint selection and environment restoration

The default mode sets `LIBTMUX_SOCKET_PATH` in the child environment. `--socket-mode name` sets `LIBTMUX_SOCKET_NAME=example` and gives tmux a private `TMUX_TMPDIR`. Both modes remove inherited `TMUX`, `TMUX_PANE` and the other libtmux socket selector from the child environment. The calling process's environment remains unchanged.

Use a named socket for the same program:

```console
$ python3 scripts/example_environment.py \
    --output-dir /tmp/session-example-name-result \
    --socket-mode name \
    -- python3 examples/session_scope.py
```

`--tmux` selects the executable used for fixture startup and places that executable on the child's `PATH` as `tmux`. It also supplies `TMUX_BIN` and `LIBTMUX_TMUX` for ports that recognize those variables. Explicit endpoint arguments in a program still take precedence over library environment defaults. This runner does not rewrite them or provide operating-system isolation.

## Native documentation commands

The command after `--` can invoke a language's test runner, a compiled example, Sphinx or Python doctest. Keep each format's existing authoring syntax and expected-output checks. No custom fence tag is needed to pass a native command through the supervisor.

For a standalone doctest transcript:

```console
$ python3 scripts/example_environment.py \
    --output-dir /tmp/doctest-example-result \
    -- python3 -m doctest -v docs/session.txt
```

For Sphinx reStructuredText or MyST examples:

```console
$ python3 scripts/example_environment.py \
    --output-dir /tmp/sphinx-example-result \
    -- python3 -m sphinx -b doctest -E -a -W docs docs/_build/doctest
```

Sphinx still owns test groups, setup, cleanup, flags and expected output. Python's doctest runner still owns prompts, exception matching and output checks. Markdown and Astro Markdown/MDX require a collector that selects the displayed program; invoking an Astro build alone does not execute its fences. This supervisor does not collect blocks, compare rendered source or certify that a native runner executed any tests. Those checks belong to the format adapter and its receipt.

## Failure and process cleanup

The supervisor retains the example's process handle and, in running mode, the foreground fixture's handle. After the command exits, it signals only its accepted child processes and reaps orphaned descendants. Cleanup uses process identities, so it does not rediscover and kill a daemon by a socket name that may have been reused.

While the example runs, the supervisor also adopts orphaned descendants and reaps children that have exited. It leaves live children running. This lets a library's cleanup operation observe daemon termination through PID disappearance when its runtime lacks pidfd bindings; an exited daemon cannot remain a zombie until the example returns.

The controller and supervisor reset an inherited ignored `SIGCHLD` disposition before starting children, preserving their actual exit statuses. If allocating a pidfd fails after a child starts, the invocation fails but retains that child for cleanup. The single supervisor thread can terminate and reap its own unreaped child without a pidfd; the receipt identifies that fallback as `unreaped-child`. A child-inventory error does not stop cleanup of known children, but it prevents the runner from claiming complete cleanup or removing the socket directory.

The execution timeout defaults to 30 seconds. Startup and cleanup each have separate five-second limits. A nonzero exit, timeout or signal remains a failure even when cleanup succeeds. If both the command and cleanup fail, `result.json` contains both errors. The private socket directory is removed only after all accepted child exits are observed; an uncertain cleanup retains it for inspection.

The controller and supervisor are separate processes. An interrupted or killed controller closes their pipe, which requests cleanup. Killing the supervisor itself with `SIGKILL`, losing the host or losing filesystem access can prevent a final receipt; this runner does not claim recovery from those cases. An incomplete receipt is not a successful run.

This external runner requires Linux, `/proc`, Python 3.10 or later and kernel pidfd support. It uses libc when the interpreter lacks Python's pidfd bindings and checks availability before starting a fixture. These are requirements of this runner, not changes to the language libraries' supported platforms or versions.

## Check the supervisor

Run its live tests against the selected tmux executable:

```console
$ python3 scripts/test_example_environment.py -v
```

The tests cover both selectors, both initial server conditions, unchanged parent environment, parallel endpoint isolation, command failure, orphaned processes, timeout, command crash, controller interruption or crash, inherited signal state, pidfd allocation and child-inventory failures, paired body and cleanup errors, and refusal to reuse an old output directory. The absent-mode checks start a real daemon from the child program and leave it for the runner to retire. Each invocation records the accepted process identities and exit observations. These tests do not establish format-adapter coverage or execution of every language port.
