---
title: plan
description: Inspect the ordered operations needed to create a Ruby workspace.
port: ruby
product: workspace
sidebar:
  group: CLI reference
  label: plan
  order: 2
tableOfContents: true
---

`plan` lists the ordered creation operations without applying them. By
default it reads only the configuration. It does not contact tmux or execute
the workspace's shell commands.

## Inspect an offline plan

Save the [complete example configuration](../../examples/) as `workspace.yaml`,
then inspect its plan:

```console
$ libtmux-workspace plan \
    --json \
    workspace.yaml
```

The JSON result includes configured command text and paths. Treat it as
application data, not a redacted diagnostic. Without `--json`, the output
lists the mode, step count, and each step's operation, target, and effect.

## Inspect a live server

`--live` acquires a snapshot from an existing server before planning. It
requires `--socket PATH`; passing a socket without `--live` is invalid.
Use the private server prepared in the [load walkthrough](../load/#create-a-workspace):

```console
$ libtmux-workspace plan \
    --live \
    --socket "$WORKSPACE_TMP/tmux.sock" \
    --json \
    workspace.yaml
```

Run this before loading the workspace. The manager creates new sessions; it
does not reconcile an existing session with the file. A live snapshot describes
the server when captured, so inspect the later load result rather than assuming
the server stayed unchanged.

## Options and failures

`--timeout SECONDS` bounds the live snapshot operation. It defaults to `5` and
must be finite and positive. The [common options](../#input-and-common-options)
control file discovery, JSON output, and explicit environment expansion.
`--attach`, `--switch`, and `--compensate` are invalid for planning.

Invalid arguments or configuration return status `2`. An unavailable live
server returns an execution error. See [exit statuses](../#output-and-exit-statuses)
before using a plan in automation.

[CLI parser and implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-workspace/lib/libtmux/workspace/cli.rb).
