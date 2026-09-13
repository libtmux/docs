---
title: "Shell completion"
description: "Generate completion from command definitions and check native availability."
port: swift
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

ArgumentParser defines the native command graph and supplies
`--generate-completion-script` for shell completion. Manual, DocC, and site
metadata integration remain separate work. Use supported parser APIs for those
exports; private parser reflection is not a stable contract.

Completion is derived from actual command metadata. It must include nested
import commands, local short flags, positional arity, mutually exclusive
choices, and all-command machine options. Verify generated scripts with the installed
executable and target shell.

See the [command tree](../) and [compatibility
reference](../../reference/compatibility/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
