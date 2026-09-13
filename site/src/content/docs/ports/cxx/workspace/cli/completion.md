---
title: "Shell completion"
description: "Generate completion from command definitions and check native availability."
port: cxx
product: workspace
sidebar:
  label: "Shell completion"
  group: "CLI reference"
  order: 22
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

tmuxp uses the separately installed `shtab` package for experimental completion. The parser entry point is [`tmuxp.cli.create_parser`](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py). Generate a script in an environment that can import both packages, then use the shell-specific installation procedure from the [upstream completion guide](https://tmuxp.git-pull.com/cli/completion/).

## Native completion

The local C++ CLI generates Bash, Zsh and Fish completion. Build it through
[installation](../../guides/installation/) and make the resulting
`tmux-workspace` executable available on `PATH`.

Enable Bash completion in the current shell:

```console
$ source <(tmux-workspace --generate-completion bash)
```

For Zsh, initialise its completion system and load the generated script:

```console
$ autoload -Uz compinit && compinit && source <(tmux-workspace --generate-completion zsh)
```

For Fish:

```console
$ tmux-workspace --generate-completion fish | source
```

Completion includes nested import commands, command-specific flags, enumerated
values and file paths, including names containing spaces. It does not start
tmux or read workspace files. Dynamic session names and configuration aliases
are not suggested. Add the matching setup command to your shell configuration
to enable completion in later sessions.

This is part of the unreleased native CLI. The documentation exporter remains
separate from shell completion.

See the [command tree](../) and [compatibility
reference](../../reference/compatibility/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
