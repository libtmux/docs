---
description: Build the workspace command and load a session on a private tmux socket.
product: workspace
sidebar:
  group: Guides
  label: Install and load a workspace
  order: 23
tableOfContents: true
title: Install and load a workspace
---

<!-- port:py -->
The runnable terminal loader is the separate Python application tmuxp. Its
documented prerequisites are Python 3.10 or newer and tmux 3.2 or newer. Install
it in an isolated tool environment with uv:
```console
$ uv tool install tmuxp
```

The tool environment owns tmuxp's Python dependencies, including libtmux.

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
## Continue

[Discovery](../discovery/) explains project files and saved names. [Configuration](../../configuration/) describes accepted fields, and [load](../../cli/load/) documents all flags.
[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Build the documented `tmux-workspace` revision, then load a small session on a
private socket. Use a Unix shell with tmux 3.2a or newer on `PATH`.

## Build the command

Fetch the documented source revision, then build from its repository root.
Keep the exported `PATH` in this shell for the rest of the walkthrough.

<!-- port:ts -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-ts.git
```

```console
$ cd libtmux-ts
```

```console
$ git fetch --depth=1 origin f36d692552bb9a373b45338bb5fece854e57cc3d
```

```console
$ git checkout --detach FETCH_HEAD
```

Use Bun and Node.js 22 or newer. Install the locked dependencies and build the
core package before the CLI:

```console
$ bun install --frozen-lockfile
```

```console
$ bun run --cwd packages/libtmux build
```

```console
$ bun run --cwd packages/workspace-cli build
```

```console
$ WORKSPACE_BIN="$(mktemp -d)"
```

```console
$ ln -s "$PWD/packages/workspace-cli/dist/main.js" "$WORKSPACE_BIN/tmux-workspace"
```

```console
$ export PATH="$WORKSPACE_BIN:$PATH"
```

The launcher runs the built JavaScript using Node. Keep the source directory
in place while using it.
<!-- /port -->
<!-- port:rs -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-rs.git
```

```console
$ cd libtmux-rs
```

```console
$ git fetch --depth=1 origin e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4
```

```console
$ git checkout --detach FETCH_HEAD
```

Use the Rust toolchain selected by `rust-toolchain.toml`:

```console
$ cargo build --locked -p tmux-workspace --bin tmux-workspace
```

```console
$ export PATH="$PWD/target/debug:$PATH"
```
<!-- /port -->
<!-- port:go -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-go.git
```

```console
$ cd libtmux-go
```

```console
$ git fetch --depth=1 origin bb06e26e116e941813ca40bf45e7e3a47d38f52a
```

```console
$ git checkout --detach FETCH_HEAD
```

Use Go 1.26 or newer. Building from the repository root selects its workspace
modules:

```console
$ go build -o tmux-workspace ./workspace/cmd/tmux-workspace
```

```console
$ export PATH="$PWD:$PATH"
```
<!-- /port -->
<!-- port:java -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-java.git
```

```console
$ cd libtmux-java
```

```console
$ git fetch --depth=1 origin 3e5b20d22af3890ae5f7f52842e4b05d170a983f
```

```console
$ git checkout --detach FETCH_HEAD
```

Use JDK 25 or newer and the repository's Gradle wrapper:

```console
$ ./gradlew --no-daemon --max-workers=2 :libtmux-workspace-cli:installDist
```

```console
$ export PATH="$PWD/libtmux-workspace-cli/build/install/tmux-workspace/bin:$PATH"
```

Keep the distribution's `bin` and `lib` directories together. Set `JAVA_HOME`
to the JDK if Java is not already on `PATH`.
<!-- /port -->
<!-- port:dotnet -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-dotnet.git
```

```console
$ cd libtmux-dotnet
```

```console
$ git fetch --depth=1 origin f77fe776ba67a04abb20ddbbc26cf4a000d63b74
```

```console
$ git checkout --detach FETCH_HEAD
```

Use the .NET 10 SDK to build the command:

```console
$ dotnet build src/LibTmux.Workspace.Cli/LibTmux.Workspace.Cli.csproj --configuration Release
```

```console
$ WORKSPACE_BIN="$(mktemp -d)"
```

```console
$ ln -s "$PWD/src/LibTmux.Workspace.Cli/bin/Release/net10.0/LibTmux.Workspace.Cli" "$WORKSPACE_BIN/tmux-workspace"
```

```console
$ export PATH="$WORKSPACE_BIN:$PATH"
```

Keep the build directory and the matching .NET runtime available when using
this launcher.
<!-- /port -->
<!-- port:cxx -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-cxx.git
```

```console
$ cd libtmux-cxx
```

```console
$ git fetch --depth=1 origin 9c8c6a264114277df84c9f6819855093adae5c6e
```

```console
$ git checkout --detach FETCH_HEAD
```

Use the compiler and CMake requirements in the repository's `cxx-dev` preset:

```console
$ cmake --preset cxx-dev \
    -DLIBTMUX_BUILD_TESTS=OFF \
    -DLIBTMUX_BUILD_EXAMPLES=OFF \
    -DLIBTMUX_BUILD_MCP_SERVER=OFF
```

```console
$ cmake --build --preset cxx-dev --target tmux-workspace -j2
```

```console
$ export PATH="$PWD/build/cxx-dev/apps/workspace:$PATH"
```
<!-- /port -->
<!-- port:swift -->
```console
$ git clone --filter=blob:none https://github.com/libtmux/libtmux-swift.git
```

```console
$ cd libtmux-swift
```

```console
$ git fetch --depth=1 origin 53c67947879f4976ddf2c43f3c8df7c7671c5b19
```

```console
$ git checkout --detach FETCH_HEAD
```

Use Swift 6.2 and enable YAML decoding for this walkthrough:

```console
$ swift build --force-resolved-versions --traits YAMLWorkspaces --product tmux-workspace
```

```console
$ export PATH="$PWD/.build/debug:$PATH"
```

A Linux executable still needs its Swift runtime libraries. Keep the matching
toolchain available when running it.
<!-- /port -->

```console
$ tmux-workspace --help
```

## Create the input

Keep this shell open. Create a temporary working directory on a filesystem that
supports Unix sockets, then enter it:

```console
$ WORKSPACE_TMP="$(mktemp -d)"
```

```console
$ cd "$WORKSPACE_TMP"
```

Save this as `workspace.yaml`:

```yaml title="workspace.yaml"
session_name: workspace-guide
windows:
  - window_name: editor
    layout: even-horizontal
    panes: [null, null]
```

## Load and inspect

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -f /dev/null \
    -d \
    --json \
    workspace.yaml
```

`-d` leaves the session detached. Inspect its panes using the same socket:

```console
$ tmux -S "$WORKSPACE_TMP/tmux.sock" list-panes -t '=workspace-guide:editor'
```

Attach interactively with `tmux -S "$WORKSPACE_TMP/tmux.sock" attach-session -t
'=workspace-guide'`. Detach with your tmux detach binding before continuing.

## Capture and clean up

```console
$ tmux-workspace freeze -S "$WORKSPACE_TMP/tmux.sock" --json workspace-guide
```

Try [export and reload](../export-session/) before cleanup. Capture cannot
recover original scripts, command history or application state.

Remove only the session created by this walkthrough when finished:

```console
$ tmux -S "$WORKSPACE_TMP/tmux.sock" kill-session -t '=workspace-guide'
```

The configuration remains in the temporary directory. Keep the session running
when following guides that continue this example.

## Continue

[Configuration](../../configuration/) describes execution fields;
[discovery](../discovery/) finds saved files. Read the [load reference](../../cli/load/)
and [automation](../automation/) for attachment, output and failure handling.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:dotnet -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
