---
description: Convert a complete workspace document between YAML and JSON.
product: workspace
sidebar:
  group: CLI reference
  label: Convert workspace files
  order: 12
tableOfContents: true
title: Convert workspace files
---

<!-- port:py -->
Convert a workspace document between YAML and JSON while retaining its mapping
keys.

## Change the file format

Given [`workspace.yaml`](../../guides/installation/#create-the-input) from the [installation
walkthrough](../../guides/installation/):

```console
$ tmuxp convert \
    --yes \
    workspace.yaml
```

The destination has the same stem and opposite extension. `--yes` permits
replacement of an existing destination. The original input remains. YAML
comments and textual formatting do not round-trip through JSON.

The command resolves a file or saved workspace name.
[Discovery](../../guides/discovery/) describes that lookup.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/convert.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Convert a complete workspace document between YAML and JSON. Conversion
preserves mapping fields; it does not establish that every field can be loaded.

## Inspect the result

Start with [`workspace.yaml`](../../guides/installation/#create-the-input) from the [installation
walkthrough](../../guides/installation/):

```console
$ tmux-workspace convert --json workspace.yaml
```

Without a destination, machine mode returns the converted document in its
result. YAML comments and textual formatting do not survive conversion to JSON.

## Save a file

Choose an explicit destination and encoding:

```console
$ tmux-workspace convert \
    --json \
    --workspace-format json \
    --save-to workspace.json \
    workspace.yaml
```

Replacing an existing destination requires `--force`. Keep that choice separate
from `--yes`, which answers prompts. Review the result before [loading
it](../load/).

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
