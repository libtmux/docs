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

Sphinx still owns test groups, setup, cleanup, flags and expected output. Python's doctest runner still owns prompts, exception matching and output checks. Markdown and Astro Markdown/MDX use the native collector described below; invoking an Astro build alone does not execute its fences. This supervisor does not collect blocks, compare rendered source or certify that a native runner executed any tests. Those checks belong to the format adapter and its receipt.

## Bind Markdown and Astro programs

Ordinary fences keep their language name. An external JSON recipe selects the page, files and commands to test; no test tag, wrapper, socket setting or cleanup statement belongs in the copied program. For example, the Python lifecycle branch's workspace program can appear in `site/src/pages/workspace.mdx` as:

````markdown
```python
"""Create or reuse a session and window at the ordinary configured endpoint."""

from __future__ import annotations

import libtmux

server = libtmux.Server().ensure_running()
session = server.find_or_create_session("libtmux-example").value
window = session.find_or_create_window("work").value
pane = window.panes[0]
print(session.session_name, window.window_name, pane.pane_id, flush=True)
```
````

This program needs a package revision that provides these lifecycle APIs. Select that revision and install its dependencies before running it. Rendering alone cannot establish compatibility with a released package.

Place its test recipe in `site/examples.json`:

```json
{
  "schema": 1,
  "programs": [
    {
      "id": "workspace",
      "document": "src/pages/workspace.mdx",
      "rendered": "workspace/index.html",
      "files": [
        { "path": "workspace.py", "language": "python", "block": 0 }
      ],
      "commands": [["python3", "workspace.py"]],
      "stdoutPattern": "libtmux-example work %\\d+\\n"
    }
  ]
}
```

`document` is relative to the recipe; `rendered` is relative to Astro's output directory. `block` is a zero-based index among that language's native code blocks after port selection and source inclusion. A program may select several files and run several argument arrays, such as a compiler followed by the resulting executable. Every command must succeed. Optional `stdout` checks exact output; `stdoutPattern` checks the entire final command's output with a JavaScript regular expression. Earlier commands retain separate output and exit records.

Bind the recipe, document and rendering configuration. Include library source and package metadata needed to identify the tested revision. This site's native `file="..."` includes also require `site/src/data/example-sources.json`; the adapter checks the actual cached entry and records its revision. Bind additional authored plugins, components and include inputs explicitly. The manifest checks declared inputs and supported source includes; it does not trace every dynamic import or external read made by arbitrary build code.

```console
$ python3 scripts/example_sources.py bind \
    --output artifacts/workspace-binding.json \
    --input site/examples.json site/src/pages/workspace.mdx \
    site/astro.config.ts site/src/data/example-sources.json
```

This repository's Astro integration activates when all three variables are supplied. Use a fresh output directory and receipt:

```console
$ env LIBTMUX_EXAMPLE_BINDING="$PWD/artifacts/workspace-binding.json" \
    LIBTMUX_EXAMPLE_RECIPE="$PWD/site/examples.json" \
    LIBTMUX_EXAMPLE_RENDER_RECEIPT="$PWD/artifacts/workspace-render.json" \
    pnpm --filter @libtmux/site exec astro build \
    --outDir ../artifacts/workspace-html
```

The observer checks the native input document, collects code after source inclusion and highlighting, and checks final HTML after MDX components execute. Each collected block receives an HTML data attribute that binds its identity, order, language, displayed text and Copy payload. A matching snippet elsewhere on the page cannot replace it. The attribute adds nothing to the program users copy. The receipt records authored and rendered forms: for example, Expressive Code expands tabs, and the executed file contains the displayed and copied spaces.

An enabled Astro build also creates a fresh cache beside its render receipt, with the suffix `.astro-cache`. This forces content collections to run their native collection hooks on every verification build, even when earlier builds cached the same page. Keep this directory with the run's artifacts or remove it with those artifacts afterward. Ordinary builds retain their configured cache. Repeated verification builds require distinct receipts and output directories.

Plain Markdown can use the standalone native Markdown processor. Set the recipe's `document` to a `.md` file and run:

```console
$ node site/scripts/markdown-examples.mjs render \
    --binding artifacts/workspace-binding.json \
    --recipe site/examples.json \
    --receipt artifacts/workspace-render.json \
    --output-dir artifacts/workspace-html
```

The standalone command uses the site's port/source selection plugin without syntax highlighting. An Astro page must use its Astro build so its actual plugins and MDX components are checked. Keep one binding and rendering receipt for each selected configuration.

Execute the recorded program under external tmux defaults:

```console
$ python3 scripts/example_environment.py \
    --output-dir artifacts/workspace-absent-path \
    --server-state absent --socket-mode path \
    -- node site/scripts/markdown-examples.mjs run \
    --binding artifacts/workspace-binding.json \
    --render-receipt artifacts/workspace-render.json \
    --program workspace \
    --output-dir artifacts/workspace-program \
    --receipt artifacts/workspace-execution.json
```

The command writes the rendered program to a fresh directory and executes it without a hidden prelude. Runtime and package selection come from the caller's environment. It rechecks bound files, final HTML and program bytes after execution. Repeat with fresh execution directories and receipts for running/absent servers and path/name selectors. The same rendering receipt can serve these runs while its inputs remain unchanged.

Verify the rendering and execution records together:

```console
$ node site/scripts/markdown-examples.mjs verify \
    --binding artifacts/workspace-binding.json \
    --render-receipt artifacts/workspace-render.json \
    --execution-receipt artifacts/workspace-execution.json
```

Verification rejects changed source, recipe, HTML, program files or command logs, a nonzero command, unexpected output and incomplete execution. The render and run commands refuse reused receipt paths. A process killed before completion leaves an incomplete receipt. The supervisor's separate `result.json` must also pass; source and execution checks do not establish tmux cleanup.

## Bind doctest source and expected output

[`run_doctest_examples.py`](../scripts/run_doctest_examples.py) runs transcripts with Python's `DocTestParser` and `DocTestRunner`. It also accepts `--module` for importable modules and uses `DocTestFinder` to collect their existing docstrings. It retains prompt parsing, shared state within a doctest, expected exceptions, `<BLANKLINE>`, comparison flags and skips. It fails when no examples execute.

This transcript demonstrates session cleanup. The `with` block teaches that API; ordinary usage examples leave cleanup to the external runner.

A transcript such as `docs/session.txt` keeps its ordinary imports and endpoint selection:

```pycon
>>> import uuid
>>> import libtmux
>>> server = libtmux.Server()
>>> with server.new_session(session_name=f"example-{uuid.uuid4().hex}") as session:
...     print(len(session.windows))
1
```

Create a new input manifest before running the transcript. Include every source file whose bytes the run must bind. Module selection requires its source file in the manifest; imported dependencies must be added explicitly if their source also needs binding.

The adapters compile bound Python imports from the verified source bytes. An existing `.pyc` cannot substitute older docstrings, even when its timestamp and size match the source. Python still initializes packages and resolves relative imports. Bound imports require Python's native source loader; custom loaders and bytecode-only modules fail validation. Unbound dependencies use their normal import behavior.

Run each command adapter in a fresh Python process, as the commands below do. A bound module loaded before the adapter starts fails with a diagnostic instead of reusing its in-memory objects. The adapters preserve existing cache files and record imported source paths and hashes in `sourceImports`.

Module collection retains Python's native `__test__` dictionary, including imported functions, methods, classes and modules. Bind the defining source of each object whose docstring supplies an example. For example, when `facade.py` selects a class from `objects.py` through `__test__`, include both files in `--input`. A missing defining source fails before execution and names the required file. Each collected example's receipt records its checked `definingSource` separately from the native filename, which Python may attribute to the facade. String entries in `__test__` use the containing module as their source; this checks that module's import, not the runtime origin of a dynamically assembled string. Native traversal, aliases, test globals and output checks stay unchanged.

For a decorated function, bind the Python wrapper's source. The native runners read its `__doc__`, which can differ from the wrapped function's docstring. When `functools.wraps` copies the wrapped function's docstring, bind both Python source files; the receipt lists them in `docstringSources`. A native wrapper such as `lru_cache` can use that copied string's Python source. If a wrapper has no identifiable Python source and its docstring differs from its wrapped object's docstring, collection fails with a diagnostic. Sphinx retains the native node label and records the selected autodoc object and its checked sources in `autodocObjects`, so a label that names the underlying function cannot stand in for checking the outer wrapper.

These checks cover Python object source metadata and wrapper docstring copies. They do not trace arbitrary runtime assignments, transformations or external data used to construct strings. Bind the source programs that perform those operations; the receipts make no claim about the origin of each character in a dynamically supplied docstring or `__test__` string.

```console
$ python3 scripts/example_sources.py bind \
    --output artifacts/session-binding.json \
    --input docs/session.txt
```

Run the transcript through the external supervisor. This example uses four native doctest examples: two imports, client construction and the `with` statement. Expected output stays in the transcript.

```console
$ python3 scripts/example_environment.py \
    --output-dir artifacts/session-run \
    -- python3 scripts/run_doctest_examples.py \
    --binding artifacts/session-binding.json \
    --receipt artifacts/session-source.json \
    --transcript docs/session.txt \
    --expected-tests 4
```

The source adapter reserves a new receipt before executing examples. It records each native example's source, expected output, exception, options and location. It verifies the bound files again after execution. Changed inputs, a changed test count, an old receipt path or a transcript containing only skipped examples cause failure. The supervisor separately records process cleanup. Both commands must succeed; a source receipt does not establish process cleanup.

## Bind Sphinx rendering and execution

The following reStructuredText and MyST examples demonstrate session cleanup with the same public API as the transcript above.

Author reStructuredText examples with Sphinx's existing directives. The group name `session` connects the code and expected output:

```rst
Session example
===============

.. testcode:: session

   import uuid
   import libtmux

   server = libtmux.Server()
   with server.new_session(session_name=f"example-{uuid.uuid4().hex}") as session:
       print(len(session.windows))

.. testoutput:: session

   1
```

MyST uses directive fences for the same native test group:

````markdown
# Session example

```{testcode} session
import uuid
import libtmux

server = libtmux.Server()
with server.new_session(session_name=f"example-{uuid.uuid4().hex}") as session:
    print(len(session.windows))
```

```{testoutput} session
1
```
````

[`run_sphinx_examples.py`](../scripts/run_sphinx_examples.py) calls Sphinx's native build command. Enable its binding extension after your existing `extensions` configuration, alongside `sphinx.ext.doctest` and, for MyST, `myst_parser`:

```python
import os

if os.environ.get("LIBTMUX_EXAMPLE_BINDING"):
    extensions.append("sphinx_example_binding")
```

The command adapter makes the extension importable and supplies `LIBTMUX_EXAMPLE_BINDING` and `LIBTMUX_EXAMPLE_RECEIPT` for that invocation. The conditional leaves ordinary Sphinx builds on their existing configuration. Keep reStructuredText directives, MyST directive fences, groups, setup, cleanup and expected output as authored. No additional code-fence tag is required.

Bind the project's configuration, documents and included source files. Add any further files selected by native includes; an include missing from the manifest fails validation. Build output belongs outside that explicit input set.

```console
$ python3 scripts/example_sources.py bind \
    --output artifacts/sphinx-binding.json \
    --input docs/conf.py docs/index.rst docs/session.rst
```

Render the bound source through Sphinx's HTML builder:

```console
$ python3 scripts/example_environment.py \
    --output-dir artifacts/sphinx-html-run \
    -- python3 scripts/run_sphinx_examples.py \
    --binding artifacts/sphinx-binding.json \
    --receipt artifacts/sphinx-html-source.json \
    -- -b html -E -a -W docs artifacts/sphinx-html
```

Execute the same source through Sphinx's doctest builder:

```console
$ python3 scripts/example_environment.py \
    --output-dir artifacts/sphinx-doctest-run \
    -- python3 scripts/run_sphinx_examples.py \
    --binding artifacts/sphinx-binding.json \
    --receipt artifacts/sphinx-doctest-source.json \
    -- -b doctest -E -a -W docs artifacts/sphinx-doctest
```

Compare the completed rendering and execution receipts:

```console
$ python3 scripts/example_sources.py verify \
    --binding artifacts/sphinx-binding.json \
    --receipt artifacts/sphinx-doctest-source.json \
    --sphinx-html artifacts/sphinx-html-source.json
```

The adapter records native test nodes and configuration, including hidden setup and cleanup. It compares visible blocks with the generated HTML and checks that the HTML and doctest builds saw the same documents, groups, options and test text. For autodoc examples, include the Python source in the manifest; the receipt preserves the docstring's native source label. Sphinx's normal presentation rules remain: for example, it may hide inline doctest flags and render `<BLANKLINE>` as an empty line while retaining both in the executable test text. The adapter records both forms.

For each autodoc example, the extension also checks that the Python module executed from those bound source bytes during this invocation. The HTML and doctest receipts must agree on these `autodocSources` records. The command adapter installs this import check before Sphinx loads the project's configuration and extensions.

Include the source that supplies an inherited docstring, even when the directive names a subclass or an overriding method without its own docstring. For `autoclass_content = "init"` or `"both"`, and the corresponding `class-doc-from` option, this can be a parent's `__init__` or `__new__` method. The adapter checks the provider Sphinx selects and retains Sphinx's native source label in the receipt. It preserves native inheritance, constructor selection, signature stripping and expected-output checking. An unused parent docstring adds no source-binding requirement.

For a `functools.partial` with its default docstring, Sphinx reads the wrapped function's docstring but may label it with `functools.py`. Bind the wrapped function's Python source. The adapter keeps that native label and checks the function's source; it does not require the standard library as an example input solely because of this attribution. An explicit include of the same file still requires its own binding. If the adapter cannot reconcile its provider selection with native autodoc's returned blocks, it fails certification instead of claiming a source match.

The receipt completes after Sphinx returns, including its warning-as-error status and builder cleanup. A build-finished callback alone cannot establish that result. Use `-E -a` to read every selected document instead of reusing cached doctrees. Add `--expected-tests` to the command adapter or final verifier when the project maintains an exact native test count.

The adapters count executed tests in `attempted`. On Python versions whose native count includes skips, the receipt also records that original count and subtracts the native skip count. A skipped-only run fails.

Sphinx configuration and example imports can execute arbitrary project code; the source manifest is a drift check, and the external supervisor provides tmux lifecycle control rather than operating-system isolation. Markdown and Astro use the separate native collector above; their receipts do not replace Sphinx's group and expected-output semantics.

## Failure and process cleanup

The supervisor retains the example's process handle and, in running mode, the foreground fixture's handle. After the command exits, it signals only its accepted child processes and reaps orphaned descendants. Cleanup uses process identities, so it does not rediscover and kill a daemon by a socket name that may have been reused.

While the example runs, the supervisor also adopts orphaned descendants and reaps children that have exited. It leaves live children running. This lets a library's cleanup operation observe daemon termination through PID disappearance when its runtime lacks pidfd bindings; an exited daemon cannot remain a zombie until the example returns.

The supervisor closes each completed child's pidfd after observing and reaping its exit. Completed children retain their identities and exit statuses in the receipt without consuming one descriptor per past process. Live children retain their handles, and polling supports descriptors above the `select()` limit. The receipt's `identityBinding` records the accepted binding even after the handle closes.

The controller and supervisor reset an inherited ignored `SIGCHLD` disposition before starting children, preserving their actual exit statuses. If allocating a pidfd fails after a child starts, the invocation fails but retains that child for cleanup. The single supervisor thread can terminate and reap its own unreaped child without a pidfd; the receipt identifies that fallback as `unreaped-child`. A child-inventory error does not stop cleanup of known children, but it prevents the runner from claiming complete cleanup or removing the socket directory.

The execution timeout defaults to 30 seconds. Startup and cleanup each have separate five-second limits. A nonzero exit, timeout or signal remains a failure even when cleanup succeeds. If both the command and cleanup fail, `result.json` contains both errors. The private socket directory is removed only after all accepted child exits are observed; an uncertain cleanup retains it for inspection.

The controller and supervisor are separate processes. An interrupted or killed controller closes their pipe, which requests cleanup. Killing the supervisor itself with `SIGKILL`, losing the host or losing filesystem access can prevent a final receipt; this runner does not claim recovery from those cases. An incomplete receipt is not a successful run.

This external runner requires Linux, `/proc`, Python 3.10 or later and kernel pidfd support. It uses libc when the interpreter lacks Python's pidfd bindings and checks availability before starting a fixture. These are requirements of this runner, not changes to the language libraries' supported platforms or versions.

## Check the supervisor

Run its live tests against the selected tmux executable:

```console
$ python3 scripts/test_example_environment.py -v
```

The tests cover both selectors, both initial server conditions, unchanged parent environment, parallel endpoint isolation, command failure, orphaned processes, timeout, command crash, controller interruption or crash, inherited signal state, pidfd allocation and child-inventory failures, paired body and cleanup errors, and refusal to reuse an old output directory. Descriptor regressions retain a live child while completing more children than the process's descriptor limit, exercise handles numbered 1024 or higher, and check exit status, receipt identity and refusal to signal after exit. The absent-mode checks start a real daemon from the child program and leave it for the runner to retire. Each invocation records the accepted process identities and exit observations. These tests do not establish format-adapter coverage or execution of every language port.
