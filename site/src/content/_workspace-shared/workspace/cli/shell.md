---
description: Use the optional Python runtime to inspect a workspace through the native command.
product: workspace
sidebar:
  group: CLI reference
  label: Evaluate in a workspace
  order: 17
tableOfContents: true
title: Evaluate in a workspace
---

<!-- port:py -->
Open a Python shell with tmux objects available, or pass `-c` to evaluate a
Python expression and exit.

After the [installation walkthrough](../../guides/installation/) creates its
dedicated server:

```console
$ tmuxp shell \
    -L workspace-guide \
    -c 'print(server.sessions)'
```

Optional session and window arguments select a narrower context. `--best`
chooses an available backend; explicit backends such as `--ipython` need their
packages installed in the same Python environment.

`--use-pythonrc` and `--no-startup` control startup loading. The last occurrence
wins. `--use-vi-mode` and `--no-vi-mode` follow the same ordering rule.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
`tmux-workspace shell` opens the optional Python inspection environment for a
loaded session. Code passed to `-c` executes in that environment, with tmux
objects such as `server`, `session`, `window` and `pane` available.

## Runtime requirement

Install tmuxp 1.74.0 in a separate Python environment and set
`TMUX_WORKSPACE_PYTHON` to that environment's Python executable. The native CLI
checks the runtime before evaluating code. Ordinary workspace loading does
not require this inspection runtime.

## Evaluate with a selected server

Continue the [installation walkthrough](../../guides/installation/) through its
detached load. Select its socket, session and window:

```console
$ tmux-workspace shell \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -c 'print(pane.pane_id)' \
    --json \
    workspace-guide editor
```

The result includes captured output and child status. Check the command's exit
status before consuming it. An interactive shell needs a terminal; use `-c`
when stdout belongs to automation.

`shell --help` lists backend and startup choices. Optional shell backends must
be installed in the selected Python environment.

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
