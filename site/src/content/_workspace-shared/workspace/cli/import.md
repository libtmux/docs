---
description: Choose a source format and translate it into a workspace document.
product: workspace
sidebar:
  group: CLI reference
  label: Import a workspace
  order: 18
tableOfContents: true
title: Import a workspace
---

<!-- port:py -->
Use `tmuxp import teamocil` or `tmuxp import tmuxinator` to translate a saved
workspace. Each child command requires a source. The parent groups the
importers and accepts `--help`.

- [Teamocil](../import-teamocil/) imports its session and window structure.
- [tmuxinator](../import-tmuxinator/) imports its project structure.

Review the converted commands and directories before loading the result.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Translate a saved Teamocil or tmuxinator configuration into a native workspace
document. Import reads and translates the file without creating tmux sessions
or running its pane commands.

- [Teamocil](../import-teamocil/) translates a session with named windows and panes.
- [tmuxinator](../import-tmuxinator/) translates a project with ordered windows.

```console
$ tmux-workspace import --help
```

Select a child command and an explicit source path. Preview with `--json` before
choosing `--save-to`. An existing destination requires `--force`.

Review commands, directories and layout in the translated document before
loading it. Source features the importer cannot preserve fail visibly. Use
[convert](../convert/) to change YAML/JSON encoding without translating fields.

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
