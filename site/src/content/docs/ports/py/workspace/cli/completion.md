---
title: "Shell completion"
description: "Generate completion from the Python parser and track native generator requirements."
port: py
product: workspace
sidebar:
  label: "Shell completion"
  group: "CLI reference"
  order: 22
tableOfContents: true
---

This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.

tmuxp uses the separately installed `shtab` package for experimental completion. The parser entry point is [`tmuxp.cli.create_parser`](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py). Generate a script in an environment that can import both packages, then use the shell-specific installation procedure from the [upstream completion guide](https://tmuxp.git-pull.com/cli/completion/).

There is no native workspace executable to generate completions from in this
prototype. The proposed parser choices provide different generators: Cobra has
command-tree completion and documentation export, clap has completion and
man-page companions, ArgumentParser has completion and documentation tools,
picocli has code generation, and Commander, System.CommandLine, and CLI11 need
their documented tooling or an explicit metadata adapter.

Completion is derived from actual command metadata. It must include nested
import commands, local short flags, positional arity, mutually exclusive
choices, and all-command machine options once implemented. Do not ship a static
completion script for a guessed executable name.

See the [command tree](../) and [compatibility
reference](../../reference/compatibility/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
