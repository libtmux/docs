---
title: Ruby workspace guides
description: Validate, inspect, and explicitly apply a Ruby workspace plan.
port: ruby
product: workspace
sidebar:
  label: Guides
  order: 1
---

## Validate without tmux

Validation reads and bounds the configuration without starting or contacting a
tmux server.

```console
$ libtmux-workspace validate workspace.yaml
```

## Inspect an offline plan

An offline plan lists the ordered creation operations. JSON output includes
configured commands and paths, so treat it as application data rather than a
redacted diagnostic.

```console
$ libtmux-workspace plan \
    --json \
    workspace.yaml
```

## Load on an explicit socket

Start an application-owned server, then pass its socket path to `load`.

```console
$ libtmux-workspace load \
    --socket "$TMUX_SOCKET" \
    --json \
    workspace.yaml
```

`plan --live` requires the same selector. `--compensate` enables guarded
cleanup of positively identified created state after failure; it cannot undo
shell effects. Attach and client switching are explicit post-apply choices,
not defaults.

[Source-owned CLI guide](../source-guide/#command-line-interface)
