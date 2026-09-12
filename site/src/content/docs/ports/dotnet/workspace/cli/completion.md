---
title: "Shell completion"
description: "Generate completion from command definitions and check native availability."
port: dotnet
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

System.CommandLine defines the native command graph. `--generate reference`
exports its metadata; `--generate man`, `bash`, `zsh`, and `fish` render the other
formats. The completion scripts offer command and option names without full
argument context. Spectre.Console owns human presentation separately.

Completion is derived from actual command metadata. It must include nested
import commands, local short flags, positional arity, mutually exclusive
choices, and all-command machine options. Verify generated scripts with the installed
executable and target shell.

See the [command tree](../) and [compatibility
reference](../../reference/compatibility/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
