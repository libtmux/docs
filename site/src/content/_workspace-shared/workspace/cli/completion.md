---
description: Generate completion for the installed workspace command.
product: workspace
sidebar:
  group: CLI reference
  label: Shell completion
  order: 22
tableOfContents: true
title: Shell completion
---

<!-- port:py -->
tmuxp uses the optional `shtab` package to generate experimental shell completion
from its argparse definitions. Install it in the same Python environment as
tmuxp, then follow the [completion setup](https://tmuxp.git-pull.com/cli/completion/)
for your shell.

Generate the script again after upgrading tmuxp so it matches the installed
parser. The parser is available through `tmuxp.cli.create_parser`.

[Parser source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Generate completion using the installed `tmux-workspace` command. The script
matches that executable's command definitions.

## Enable Bash completion

<!-- port:ts -->
```console
$ tmux-workspace completion bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:rs -->
```console
$ tmux-workspace --generate bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:go -->
```console
$ tmux-workspace --generate-completion bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:java -->
```console
$ tmux-workspace --generate bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:csharp -->
```console
$ tmux-workspace --generate bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:cxx -->
```console
$ tmux-workspace --generate-completion bash > tmux-workspace.bash
```
<!-- /port -->
<!-- port:swift -->
```console
$ tmux-workspace --generate-completion-script bash > tmux-workspace.bash
```
<!-- /port -->

Check the generated script before loading it in your current Bash session:

```console
$ bash -n tmux-workspace.bash
```

```bash
source ./tmux-workspace.bash
```

Keep the script in your shell's completion directory to load it in later
sessions. Regenerate it after upgrading the CLI.

## Other shells

<!-- port:ts -->
`completion zsh` and `completion fish` generate the other supported shells.
<!-- /port -->
<!-- port:rs -->
`--generate` also accepts `zsh`, `fish`, `powershell` and `elvish`.
<!-- /port -->
<!-- port:go -->
`--generate-completion` also accepts `zsh`, `fish` and `powershell`.
<!-- /port -->
<!-- port:java -->
The CLI provides Bash completion.
<!-- /port -->
<!-- port:csharp -->
`--generate zsh` and `--generate fish` generate the other supported shells.
<!-- /port -->
<!-- port:cxx -->
`--generate-completion` also accepts `zsh` and `fish`.
<!-- /port -->
<!-- port:swift -->
`--generate-completion-script` also accepts `zsh` and `fish`.
<!-- /port -->

Follow the selected shell's completion setup before sourcing its script.
Generating a script does not start tmux or load workspace files.

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
