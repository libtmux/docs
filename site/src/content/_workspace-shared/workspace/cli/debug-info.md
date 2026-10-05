---
description: Collect the workspace CLI runtime, configuration and tmux diagnostics..
product: workspace
sidebar:
  group: CLI reference
  label: Inspect runtime diagnostics
  order: 14
tableOfContents: true
title: Inspect runtime diagnostics
---

<!-- port:py -->
Collect tmuxp, Python, tmux, configuration and environment diagnostics.

## Collect a report

```console
$ tmuxp debug-info --json
```

The command writes one JSON object. Named path fields mask the home directory,
but raw tmux output arrays are preserved. Review diagnostics before sharing them
because names, commands and raw values may describe your environment.

See [troubleshooting](../../guides/troubleshooting/) for connection and
configuration failures.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/debug_info.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Collect the workspace CLI runtime, configuration and tmux diagnostics.

## Collect a report

```console
$ tmux-workspace debug-info --json
```

Review the report before sharing it. Paths, session names and raw tmux values
can describe your environment even when home-directory prefixes are redacted.
Use the failed command exit status and stderr to diagnose its actual failure.

See [troubleshooting](../../guides/troubleshooting/) and the [machine output
reference](../../reference/output/).

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
