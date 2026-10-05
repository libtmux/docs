---
description: Translate a tmuxinator project into a workspace document.
product: workspace
sidebar:
  group: CLI reference
  label: Import from tmuxinator
  order: 20
tableOfContents: true
title: Import from tmuxinator
---

<!-- port:py -->
Translate a tmuxinator workspace into tmuxp configuration, preserving an
explicit boundary around dynamic Ruby configuration.

## Select an existing source

With [`project.yml`](../../guides/discovery/) already present in the configured tmuxinator directory:

```console
$ tmuxp import tmuxinator project
```

`TMUXINATOR_CONFIG` overrides the source directory and expands a leading tilde.
A source argument is effectively required, and omission exits 2 despite
optional-looking help. The reference previews and saves the transformed document
interactively.

Do not interpret successful YAML parsing as support for ERB templates or
arbitrary Ruby execution. Inspect the resulting commands and
directories before loading. See [environment](../../configuration/environment/)
and [output](../../reference/output/).

An extensionless name searches the configured source directory. A filename
with an extension is resolved relative to the current directory unless you
provide an explicit path.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | effectively required | `nargs="?"` belongs to a required exclusive group; omission exits 2. Source lookup honors `TMUXINATOR_CONFIG`. |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
describes the formats supported by each command.
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Import a saved tmuxinator project without starting tmux. Save this source as
`tmuxinator.yaml`:

```yaml title="tmuxinator.yaml"
name: imported-project
windows:
  - editor:
      - printf ready
      - printf second
```

## Preview the translation

```console
$ tmux-workspace import tmuxinator --json ./tmuxinator.yaml
```

The window's command list remains sequential commands in one pane. Use an
explicit source `panes` list when the project needs separate panes.

## Save the workspace

```console
$ tmux-workspace import tmuxinator \
    --json \
    --workspace-format yaml \
    --save-to imported-tmuxinator.yaml \
    ./tmuxinator.yaml
```

Existing destinations require `--force`. The importer rejects unexpanded ERB
templates and unsupported lifecycle or runtime fields before writing. It does
not evaluate Ruby. Review the translated commands and absolute directories
before [loading](../load/) the file.

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
