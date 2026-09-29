---
description: Resolve a workspace file or saved name and open it in an editor.
product: workspace
sidebar:
  group: CLI reference
  label: Edit a workspace
  order: 13
tableOfContents: true
title: Edit a workspace
---

<!-- port:py -->
Resolve a saved workspace or file and open it in the configured editor.

## Open a workspace

With `workspace.yaml` saved and `vi` installed:

```console
$ EDITOR=vi tmuxp edit workspace.yaml
```

The command passes the entire `EDITOR` value as one executable name followed by
the file path. It does not split editor arguments. Use a wrapper executable when
arguments are needed.

The command waits for the editor but does not propagate its exit status. Inspect
the edited file before loading it. [Discovery](../../guides/discovery/) explains
saved workspace names.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/edit.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Resolve a workspace file or saved name and open it in an editor. Use an explicit
path when editing a particular file.

## Open the file

With `vi` installed and `workspace.yaml` saved:

```console
$ EDITOR=vi tmux-workspace edit workspace.yaml
```

<!-- port:cxx -->
`VISUAL` takes precedence over `EDITOR`. Unset it or select the same editor there when using the command above.
<!-- /port -->

The CLI waits for the editor and reports a failed child through its exit status.
Editor values can contain quoted arguments. They are parsed as an argument list;
shell pipelines and redirection require an explicit shell or wrapper.

[Discovery](../../guides/discovery/) explains saved workspace names.

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
