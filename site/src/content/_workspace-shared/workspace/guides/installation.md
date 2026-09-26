---
description: Run the available Python workspace tool on a dedicated tmux socket.
product: workspace
sidebar:
  group: Guides
  label: Install and load a workspace
  order: 23
tableOfContents: true
title: Install and load a workspace
ports:
  ts:
    description: Build the local TypeScript workspace CLI and load a session on a private tmux socket.
  rs:
    description: Build the local Rust workspace CLI and load a session on a private tmux socket.
  go:
    description: Build the local Go workspace CLI and load a session on a private tmux socket.
  java:
    description: Build the local Java workspace CLI and load a session on a private tmux socket.
  dotnet:
    description: Install the prerelease .NET workspace CLI from NuGet and load a session on a private tmux socket.
  cxx:
    description: Build the local C++ workspace CLI and load a session on a private tmux socket.
  swift:
    description: Build the local Swift workspace CLI and load a session on a private tmux socket.
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts -->Build and run the native TypeScript `tmux-workspace` command from the local
<!-- /port --><!-- port:rs -->Build and run the native Rust `tmux-workspace` command from the local
<!-- /port --><!-- port:go -->Build and run the native Go `tmux-workspace` command from the local
<!-- /port --><!-- port:java -->Build and run the native Java `tmux-workspace` command from the local
<!-- /port --><!-- port:dotnet -->Install and run the native .NET `tmux-workspace` command from its NuGet
prerelease, `LibTmux.Workspace.Cli`. **This is a partial, prerelease
implementation.**
<!-- /port --><!-- port:cxx -->Build and run the native C++ `tmux-workspace` command from the local
<!-- /port --><!-- port:swift -->Build and run the native Swift `tmux-workspace` command from the local
<!-- /port --><!-- port:ts,rs,go,java,cxx,swift -->`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.
<!-- /port -->
<!-- port:py -->The runnable terminal loader is the separate Python application tmuxp. Its
documented prerequisites are Python 3.10 or newer and tmux 3.2 or newer. Install
it in an isolated tool environment with uv:
<!-- /port --><!-- port:ts,rs,go,java,cxx,swift -->## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

<!-- /port --><!-- port:dotnet -->## Install from NuGet

Use a Unix environment with tmux 3.2a or newer on `PATH` for this walkthrough.

<!-- /port --><!-- port:ts -->Use the Bun version in the checkout's `packageManager` field to install dependencies
and build. Run the result with Node.js 22 or newer, or Bun 1.3.14 or newer. Build the core before the
CLI, running the two build commands sequentially.
<!-- /port --><!-- port:rs -->Use Rust and Cargo through rustup so the checkout's
[rust-toolchain.toml](https://github.com/libtmux/libtmux-rs/blob/master/rust-toolchain.toml)
selects its pinned compiler. The full CLI minimum-toolchain and packaging gates
remain open; the library's minimum Rust version is not a completed CLI guarantee.
<!-- /port --><!-- port:go -->Use Go 1.26 or newer, as required by the checkout's
[workspace module](https://github.com/libtmux/libtmux-go/blob/master/workspace/go.mod).
Build from the repository root so its Go workspace selects the local modules.
<!-- /port --><!-- port:java -->Use JDK 21 or newer and the repository's Gradle wrapper. The local
application distribution includes its Java dependencies and needs Java on
`PATH`, or `JAVA_HOME` set to a compatible JDK.
<!-- /port --><!-- port:dotnet -->Installing needs the .NET SDK 8 or newer. The tool runs on the .NET 8 or
.NET 10 runtime on Unix. For an SDK outside the platform's default
installation location, set `DOTNET_ROOT` to that installation directory
before running the tool.
<!-- /port --><!-- port:cxx -->The development preset requires Clang 18.1.3 with libc++ 18.1, CMake 3.25 or
newer, and Ninja. It builds C++23 and fetches pinned optional CLI dependencies.
Core libtmux remains independent of CLI11, yaml-cpp and nlohmann JSON.
<!-- /port --><!-- port:swift -->Use Swift 6.2 or newer on Linux. On macOS, use Xcode's Swift 6.3 or newer
toolchain; the subprocess dependency requires it. The package targets macOS
13 or newer. Enable the YAML build trait for this walkthrough; JSON-only
builds can omit it.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
```console
<!-- /port --><!-- port:ts -->$ bun install --frozen-lockfile
<!-- /port --><!-- port:rs -->$ cargo build \
    --locked \
    --package tmux-workspace \
    --bin tmux-workspace \
    --release \
    --jobs 2
<!-- /port --><!-- port:go -->$ GOMAXPROCS=2 go build \
    -p 2 \
    -o tmux-workspace \
    ./workspace/cmd/tmux-workspace
<!-- /port --><!-- port:java -->$ ./gradlew :workspace-cli:installDist \
    --max-workers=2 \
    --no-parallel
<!-- /port --><!-- port:dotnet -->$ dotnet tool install \
    --global \
    --prerelease \
    LibTmux.Workspace.Cli
<!-- /port --><!-- port:cxx -->$ cmake --preset cxx-dev \
    -DLIBTMUX_BUILD_WORKSPACE_CLI=ON
<!-- /port --><!-- port:swift -->$ swift build \
    --jobs 2 \
    --traits YAMLWorkspaces \
    --force-resolved-versions \
    --product tmux-workspace
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->```

<!-- /port --><!-- port:ts,cxx -->```console
<!-- /port --><!-- port:ts -->$ bun run --cwd packages/libtmux build
<!-- /port --><!-- port:cxx -->$ cmake --build --preset cxx-dev \
    --target tmux-workspace \
    --parallel 2
<!-- /port --><!-- port:ts,cxx -->```

<!-- /port --><!-- port:ts -->```console
$ bun run --cwd packages/workspace-cli build
```

The local package names its executable `tmux-workspace`; this walkthrough
runs the built entrypoint through Node. Bun can run the same entrypoint. Keep
the complete generated output directory, including split chunks, and the
local core dependency. Installing the published core library alone does not
install this unreleased CLI.
<!-- /port --><!-- port:rs -->The CLI feature is enabled by default in the local crate. This command
builds its executable; installing the published library crate does not establish
that this local CLI is available in a release.
<!-- /port --><!-- port:go -->Ordinary search uses Go regular expressions. Python-only regex behavior is
explicitly selected with `--regex-engine python`; it checks Python 3.10 or newer.
Python shell and plugin/custom-builder execution require tmuxp 1.74.0.
Plugin append uses the current session when the document has no `before_script`
key. Native before-script arguments validate for all inputs before any session
is created or changed.
<!-- /port --><!-- port:java -->Keep the generated distribution together: its launcher uses libraries
beside it. This local application distribution is separate from published
Java library artifacts.
<!-- /port --><!-- port:dotnet -->`--prerelease` is required: every release so far carries an `-alpha` tag,
and NuGet skips those unless asked. A global tool installs into
`~/.dotnet/tools`; add that directory to `PATH` if the SDK reports it
missing.
<!-- /port --><!-- port:cxx -->Use `load -d` for the detached workflow below. The CLI rejects unsupported
legacy `-8` before file or backend access; `-2` selects 256-colour mode.
Several other planned commands/options appear in help with explicit
unavailable behavior.
<!-- /port --><!-- port:swift -->Outside tmux, this local loader requires an explicit endpoint. The
walkthrough supplies one with `-S`. A copied Linux executable still needs the
Swift runtime libraries supplied by its toolchain; it is not a standalone
distribution.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Inspect the <!-- port:ts,rs,go,java,cxx,swift -->built<!-- /port --><!-- port:dotnet -->installed<!-- /port --> command:

```console
<!-- /port --><!-- port:ts -->$ node packages/workspace-cli/dist/main.js --help
<!-- /port --><!-- port:rs -->$ target/release/tmux-workspace --help
<!-- /port --><!-- port:go -->$ ./tmux-workspace --help
<!-- /port --><!-- port:java -->$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace --help
<!-- /port --><!-- port:dotnet -->$ tmux-workspace --help
<!-- /port --><!-- port:cxx -->$ build/cxx-dev/apps/workspace/tmux-workspace --help
<!-- /port --><!-- port:swift -->$ .build/debug/tmux-workspace --help
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->```

## Create the input

Keep this shell open for the walkthrough. Create a temporary directory for
its configuration and private tmux socket:

```console
$ WORKSPACE_TMP="$(mktemp -d)"
```

Write a minimal configuration with two blank shell panes to
[`workspace.yaml`](./#create-the-input) inside that directory:

```console
$ cat > "$WORKSPACE_TMP/workspace.yaml" <<'YAML'
session_name: workspace-guide
windows:
  - window_name: editor
    layout: even-horizontal
    panes: [null, null]
YAML
```

## Load and inspect

Load detached on the temporary socket. The JSON result describes the load;
`-d` prevents terminal attachment:

```console
<!-- /port --><!-- port:ts -->$ node packages/workspace-cli/dist/main.js load \
<!-- /port --><!-- port:rs -->$ target/release/tmux-workspace load \
<!-- /port --><!-- port:go -->$ ./tmux-workspace load \
<!-- /port --><!-- port:java -->$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace load \
<!-- /port --><!-- port:dotnet -->$ tmux-workspace load \
<!-- /port --><!-- port:cxx -->$ build/cxx-dev/apps/workspace/tmux-workspace load \
<!-- /port --><!-- port:swift -->$ .build/debug/tmux-workspace load \
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --json \
    "$WORKSPACE_TMP/workspace.yaml"
```

Inspect the two panes through the same endpoint:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    list-panes \
    -t '=workspace-guide:editor'
```

Attach with tmux when ready:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    attach-session \
    -t '=workspace-guide'
```

Detach with your configured tmux detach binding. Capture the live session
without choosing a file destination:

```console
<!-- /port --><!-- port:ts -->$ node packages/workspace-cli/dist/main.js freeze \
<!-- /port --><!-- port:rs -->$ target/release/tmux-workspace freeze \
<!-- /port --><!-- port:go -->$ ./tmux-workspace freeze \
<!-- /port --><!-- port:java -->$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace freeze \
<!-- /port --><!-- port:dotnet -->$ tmux-workspace freeze \
<!-- /port --><!-- port:cxx -->$ build/cxx-dev/apps/workspace/tmux-workspace freeze \
<!-- /port --><!-- port:swift -->$ .build/debug/tmux-workspace freeze \
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->    -S "$WORKSPACE_TMP/tmux.sock" \
    --json \
    workspace-guide
```

Capture reports recoverable live state. It cannot reconstruct the original
command history, script or plugin definitions. Remove the walkthrough session
when finished:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    kill-session \
    -t '=workspace-guide'
```

The configuration remains in the temporary directory until you remove it.
Every tmux command above addresses that private socket.

## Current limits

<!-- /port --><!-- port:ts -->Interactive prompts and complete configuration/platform acceptance remain
unfinished. Capture reports live state rather than recovering the original
workspace commands or extension intent.
<!-- /port --><!-- port:rs -->Progress and logging controls, complete terminal attachment and interruption
behavior, discovery/search edge cases, and the full configuration and platform
corpus remain unfinished. Some accepted flags are compatibility targets rather
than implemented behavior.
<!-- /port --><!-- port:go -->Append through the Python workspace bridge with a document `before_script`
key is unavailable and fails during preflight, including empty or null values.
This prevents Python's script-failure cleanup from deleting the borrowed
session. Native scripted append remains supported.
<!-- /port --><!-- port:java -->Human load progress uses terminal stderr, with five presets or a custom
`--progress-format` and a bounded `--progress-lines` panel. It preserves script
stdout/stderr, clears on completion or interruption, and is disabled for machine
output, redirected stderr, `TERM=dumb`, `--no-progress` or `TMUXP_PROGRESS=0`.
<!-- /port --><!-- port:dotnet -->Native `--log-level` filters optional diagnostics. On Linux x64, human load
displays progress on terminal stderr and `load --log-file` appends structured
logs. See the [load reference](../../cli/load/#progress-and-script-output) and
[output reference](../../reference/output/) for settings, resize and log-failure
limits.
<!-- /port --><!-- port:swift -->`load -2` forces 256-color handling in native tmux clients. Legacy `-8` is
recognized but rejected before document lookup because supported tmux versions
do not implement 88-color mode. Without `-2`, tmux detects color support.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,swift -->
<!-- /port --><!-- port:ts -->Python shell evaluation and explicit plugin/custom-builder loads require an
interpreter with tmuxp 1.74.0 installed. Select it with
`TMUX_WORKSPACE_PYTHON`; the default is `python3`. Install extension packages in
that interpreter or provide `workspace_builder_paths` relative to the workspace
file. See [hooks and builders](../../configuration/hooks/) for append and failure
behavior. Ordinary native loading of this example does not require Python.
<!-- /port --><!-- port:go -->`load -s` changes only the final input's session name; earlier inputs keep
their configured names. Legacy `-8` and `--88-colors` fail before workspace
lookup or runtime checks. Use `-2` to request 256-color mode.
<!-- /port --><!-- port:swift -->`--log-level` filters advisory diagnostics; fatal errors remain visible.
`load --log-file` appends structured lifecycle and diagnostic records to a regular
file. A write failure reports a secondary diagnostic and preserves the load result.
<!-- /port --><!-- port:go,swift -->
<!-- /port --><!-- port:go -->Some cleanup and interruption paths, diagnostic filtering, complete
configuration coverage, and portable packaging still need work. Capture cannot
reconstruct original command arguments, history or workspace extensions.
<!-- /port --><!-- port:java -->Python plugins and custom builders execute through the checked tmuxp bridge.
Extension append rejects documents containing `before_script` to preserve the
borrowed session. Complete configuration/capture coverage and full
terminal/platform acceptance remain unfinished. Progress uses the initial
terminal dimensions; it does not track resizing, and Unicode clipping is
conservative.
<!-- /port --><!-- port:dotnet -->Human prompts and full terminal workflows, plugin and custom-builder
validation, contextual completion, and the full configuration and platform
corpus remain unfinished.
<!-- /port --><!-- port:swift -->Human load displays progress on terminal stderr, with presets, custom counters
and a bounded recent-output panel. It uses the initial terminal size and
conservative Unicode clipping. Bootstrap output keeps its original stdout or
stderr destination, but is collected before display. Machine output disables
the panel and emits structured window/pane events. Interruption clears the
panel; SIGINT and SIGTERM return status 130 and stop captured children.

Terminal attachment, plugins/custom builders, further pane/window execution
settings, fuller capture, generated manuals and portable distribution remain
unfinished. The complete tmuxp flag surface is not available.
<!-- /port --><!-- port:go,java,dotnet,swift -->
<!-- /port --><!-- port:rs,go,java,dotnet,swift -->Python-specific shell behavior requires an interpreter with tmuxp 1.74.0
installed. Select it with `TMUX_WORKSPACE_PYTHON`. Ordinary native loading of
this example does not require Python.
<!-- /port --><!-- port:cxx -->Python shell/plugin/custom-builder execution, full importer/configuration
coverage and portable packaging remain unfinished. Native progress and
[shell completion](../../cli/completion/#native-completion) are implemented;
dynamic session/configuration-name suggestions remain unavailable.
Native before scripts, terminal handoff and file logging are implemented; see
[current coverage](../../reference/compatibility/) for their limits. Capture
preserves local session/window options but omits inherited/global options and
environment. It cannot recover original command arguments or history.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
## Python alternative

For the separate released tmuxp application, install its isolated Python
tool environment with uv:
<!-- /port -->
```console
$ uv tool install tmuxp
```

<!-- port:py -->The tool environment owns tmuxp's Python dependencies. Installing a native
libtmux workspace library does not install a tmuxp-compatible CLI.

## Create the input

Save this file as [`workspace.yaml`](./#create-the-input) in a writable directory:

```yaml
session_name: workspace-guide
windows:
  - window_name: editor
    layout: even-horizontal
    panes:
      - echo ready
      - echo second
```

Load the session detached. Reserve the socket name for this walkthrough:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    workspace.yaml
```

Inspect the two panes:

```console
$ tmux -L workspace-guide list-panes -t '=workspace-guide:editor'
```

Attach when ready:

```console
$ tmux -L workspace-guide attach-session -t '=workspace-guide'
```

Detach with your configured tmux detach binding. Before cleanup, optionally try
[export and reload](../export-session/). Remove only this walkthrough's session
when finished:

```console
$ tmux -L workspace-guide kill-session -t '=workspace-guide'
```
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->Follow the [Python installation guide](/py/latest/workspace/guides/installation/)
for that workflow. Installing tmuxp does not install the native command.
<!-- /port -->
## Continue

<!-- port:py -->[Discovery](../discovery/) explains project files and saved names. [Configuration](../../configuration/) describes accepted fields, and [load](../../cli/load/) documents all flags. The [compatibility reference](../../reference/compatibility/) records native builder limitations.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->[Discovery](../discovery/), [configuration](../../configuration/) and the
[load reference](../../cli/load/) explain the tmuxp compatibility model. Compare
those references with the local command's help and the limits above.
[Export and reload](../export-session/) explains the capture workflow, and the
[compatibility reference](../../reference/compatibility/) records builder gaps.
Use [Internals](../../internals/) for the library and consumer APIs.
<!-- /port -->
[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
