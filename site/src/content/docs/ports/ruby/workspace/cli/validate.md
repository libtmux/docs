---
title: validate
description: Check a Ruby workspace configuration without contacting tmux.
port: ruby
product: workspace
sidebar:
  group: CLI reference
  label: validate
  order: 1
tableOfContents: true
---

`validate` reads and checks a YAML or JSON workspace without starting tmux,
opening a socket, creating a session, or running configured shell commands.
Use it before inspecting or applying a plan.

## Check a workspace

Save the [complete example configuration](../../examples/) as `workspace.yaml`,
then validate it:

```console
$ libtmux-workspace validate workspace.yaml
```

Success prints `Workspace configuration is valid.` and exits with status `0`.
To request a JSON result:

```console
$ libtmux-workspace validate \
    --json \
    workspace.yaml
```

The result contains `valid`, `profile`, and `version`. Invalid configuration
exits with status `2`. In JSON mode, the error object is written to stdout;
otherwise diagnostics go to stderr.

## Options and limits

The [common options](../#input-and-common-options) control output and explicit
environment expansion. Omit the filename only when the current directory
contains exactly one discoverable configuration. `--socket`, `--live`,
`--attach`, `--switch`, and `--compensate` are invalid for validation.

Validation checks the [supported configuration format](../../topics/). It does
not prove that a session name is free on a server, a shell command will
succeed, or a program is installed. Use [live planning](../plan/#inspect-a-live-server)
to inspect the chosen server, and check [load results](../load/#results-and-failures)
when applying the workspace.

[CLI parser and implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-workspace/lib/libtmux/workspace/cli.rb).
