---
description: Generate command references from the parser and verify task examples against the CLI.
product: workspace
sidebar:
  group: Internals
  label: Workspace reference generation
  order: 80
tableOfContents: true
title: Workspace reference generation
---

<!-- port:py -->
tmuxp uses argparse definitions from `tmuxp.cli.create_parser` for its command
reference. The optional `shtab` integration reads that parser for completion.

## Keep syntax and behavior aligned

Preserve required and mutually exclusive groups when exporting parser metadata.
An optional-looking positional in help can still belong to a required group.
Run examples against the corresponding tmuxp revision, including prompts,
machine formats, child failures and cleanup.

The CLI reference and [workspace builder API](../../internals/) serve different
tasks. Keep their example imports, prerequisites and behavior explicit.

[Parser source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
The executable's parser owns its command names, arguments and options. Keep
reference generation tied to those definitions.

## Command metadata

<!-- port:ts -->
Commander owns the command definitions. The package generates Markdown, a JSON command catalog and completion scripts from those definitions. `docs:check` checks their freshness.
<!-- /port -->
<!-- port:rs -->
clap owns the command definitions. `--generate schema` exports command metadata, `--generate man` writes the manual, and completion generation uses the same graph.
<!-- /port -->
<!-- port:go -->
Cobra owns the command tree. `--command-tree` exports JSON metadata; `--generate-docs` accepts `markdown`, `man` or `yaml`.
<!-- /port -->
<!-- port:java -->
picocli owns the command definitions. `--generate schema` exports metadata and `--generate bash` writes completion.
<!-- /port -->
<!-- port:csharp -->
System.CommandLine owns the command definitions. `--generate reference` exports metadata; `--generate man` writes the manual.
<!-- /port -->
<!-- port:cxx -->
CLI11 owns the command definitions. The CLI derives shell completion from that graph. The site task guides describe executable operations separately from the workspace library API.
<!-- /port -->
<!-- port:swift -->
ArgumentParser owns the command definitions and `--generate-completion-script` generates shell completion. The site task guides describe executable operations separately from the workspace library API.
<!-- /port -->


See [shell completion](../../cli/completion/) for end-user setup. A generated
parser reference describes syntax; task examples also need to exercise the
underlying services and their cleanup.

## Site integration

Record the CLI's own source revision independently from the core library
reference. Keep commands, configuration and examples specific to that source.
Use the same content selection for HTML, search, Markdown and machine exports.

Verify guides against a private tmux server, with cleanup limited to the objects
the test owns. Check failure cases as well as successful construction.

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
