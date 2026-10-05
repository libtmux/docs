---
description: Find the failed stage before retrying a workspace operation.
product: workspace
sidebar:
  group: Guides
  label: Troubleshoot a workspace
  order: 27
tableOfContents: true
title: Troubleshoot a workspace
---

<!-- port:py -->
Start by identifying the failing stage. A parser error happens before a
workspace is loaded. A missing file is a discovery problem. An accepted document
can still fail during tmux creation, shell startup, command dispatch, or a
plugin callback.

## Arguments and files

Use the [command reference](../../cli/) for local flag meanings. Place root
`--color` and `--log-level` before the command. Keep multiple load filenames
together. Both importer children require a source argument. Confirm an explicit
file works before investigating saved-name discovery.

## Configuration and commands

Check the [configuration reference](../../configuration/) and the [example
gallery](../../examples/gallery/). YAML parsing alone does not validate keys or
prove builder support. A missing shell executable, directory, plugin package,
SSH target, or application can prevent an otherwise valid workspace from
behaving as intended.

Commands are sent into panes and can require shell readiness. `enter: false`
intentionally leaves text unsubmitted. Delays are measured in seconds; explicit
zero and omission differ. See [commands](../../configuration/commands/) and
[hooks](../../configuration/hooks/).

## Diagnostics and remaining state

```console
$ tmuxp debug-info --json
```

Inspect raw tmux values before sharing diagnostics. Use the same `-L` or `-S`
endpoint when inspecting a failed load. A partial build can leave sessions,
windows, and panes behind; inspect them before cleanup. Do not assume rollback
or kill an unrelated default server.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Start with the error message and exit status. A partially completed load can
leave sessions or windows running; inspect its result before retrying or
cleaning up.

## Confirm the command and input

```console
$ tmux-workspace debug-info --json
```

Check the executable version, selected tmux binary and workspace directories.
Use an explicit file path to bypass saved-name lookup. Verify the socket matches
the one used for inspection and capture.

## Common failures

| Symptom | Next check |
| --- | --- |
| Workspace not found | Explicit path, file extension and global discovery directory |
| Unsupported field | CLI configuration fields and the reported field path |
| tmux unavailable | Executable path, permissions and selected socket |
| Existing session mismatch | Running window names and the requested document |
| Layout rejected | Layout name, pane capacity and the selected tmux version |
| File already exists | Select a new output path or authorize replacement with `--force` |
| Script failed | Child status, captured output and working directory |
| Interactive context required | Use `load -d` for automation; provide a terminal for interactive work |

## Record a load

Continue the [installation walkthrough](../installation/) and append diagnostic
records to a local file:

```console
$ tmux-workspace --log-level debug load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --json \
    --log-file workspace-load.log \
    workspace.yaml
```

Logs may include script output and local paths. Inspect them before sharing a
bug report. Include the command, versions, minimal configuration, exit status
and relevant result; remove private values.

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
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
