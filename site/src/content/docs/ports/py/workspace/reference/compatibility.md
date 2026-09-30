---
title: Runtime and configuration support
description: Runtime, configuration and extension requirements for tmuxp.
port: py
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

These pages document tmuxp 1.74.0 at the source revision linked below. Install
tmuxp in its own Python environment and let its dependency resolver select a
compatible libtmux release. The walkthroughs use Python 3.10 or newer and
tmux 3.2a or newer.

## Configuration and extensions

Read [configuration](../../configuration/) for normalization, inheritance,
directories, commands and hooks. Parsing YAML alone does not establish that
a field changes builder behavior. Plugins and custom builders execute Python
code from their installed packages or configured import paths.

The [inspection shell](../../cli/shell/) runs in the same Python environment.
Optional interactive backends need their corresponding packages installed.

## Output and errors

Machine formats are command-specific. Read [output](../output/) and
[exit codes](../exit-codes/) for empty output and status exceptions before
using tmuxp in automation.

Capture reads current tmux state; it cannot recover original scripts,
application state or comments. Review captured commands and directories before
reloading. Gallery examples may require their named applications or plugins.

Use [builder internals](../../internals/) for programmatic construction and
extension development.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
