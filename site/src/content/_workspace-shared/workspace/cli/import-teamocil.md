---
description: Translate Teamocil windows and pane commands into a workspace document.
product: workspace
sidebar:
  group: CLI reference
  label: Import from Teamocil
  order: 19
tableOfContents: true
title: Import from Teamocil
---

<!-- port:py -->
Translate a Teamocil workspace into tmuxp configuration, review the result, and
select its saved representation.

## Select an existing source

With [`project.yml`](../../guides/discovery/) already present in the Teamocil configuration directory:

```console
$ tmuxp import teamocil project
```

The source lookup uses [`~/.teamocil`](./). A source argument is effectively required:
although its positional action has optional arity, it belongs to a required
exclusive group, and omission exits 2. The reference previews and saves the
transformed document interactively.

Inspect translated commands and directories before loading the result. See
[output](../../reference/output/) for the command's formats.

An extensionless name searches the configured source directory. A filename
with an extension is resolved relative to the current directory unless you
provide an explicit path.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | effectively required | `nargs="?"` belongs to a required exclusive group; omission exits 2. Source lookup uses [`~/.teamocil`](./). |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
describes the formats supported by each command.
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Import a Teamocil file without starting tmux. Save this source as `teamocil.yaml`:

```yaml title="teamocil.yaml"
session:
  name: imported-team
  windows:
    - name: editor
      layout: even-horizontal
      panes:
        - commands: [printf ready]
        - commands: [printf second]
```

## Preview the translation

```console
$ tmux-workspace import teamocil --json ./teamocil.yaml
```

The translated document preserves window and pane order. Several commands in
one Teamocil `commands` list become one semicolon-separated shell input in that
pane. Review the absolute working directories selected by the import.

## Save the workspace

```console
$ tmux-workspace import teamocil \
    --json \
    --workspace-format yaml \
    --save-to imported-teamocil.yaml \
    ./teamocil.yaml
```

Use `--force` only to replace an existing destination deliberately. Unsupported
fields, such as pane widths and filters, fail before saving. Conversion does
not prove that a command or directory will be available when you
[load](../load/) the result.

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
