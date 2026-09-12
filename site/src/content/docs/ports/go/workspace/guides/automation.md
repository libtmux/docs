---
title: "Automate workspace operations"
description: "Python automation and the local native CLI machine protocol."
port: go
product: workspace
sidebar:
  label: "Automate workspace operations"
  group: "Guides"
  order: 25
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

For the current Python loader, supply an explicit file, dedicated socket, and
`-d` to avoid attachment. `--yes` answers yes/no questions; it is not a
universal replacement for missing session, format, or destination choices.

## Read current records

```console
$ tmuxp ls --json
```

Validate the JSON object before consuming its `workspaces` array. Python search
has different empty-result behavior: no matches can produce no bytes rather than
`[]`. See [search](../../cli/search/) before relying on a pipeline.

## Proposed native machine protocol

Local native CLIs provide `--json` and `--ndjson`. Implemented services and
terminal behavior vary by port. The shared machine contract resolves choices
from arguments, avoid implicit stdin prompts, keep diagnostics on stderr, and
prevent child output or attachment from corrupting stdout. The operation result
must report partial completion instead of claiming rollback.

NDJSON load events must be observable while work is still running, followed by
exactly one terminal record. A buffered array split into lines after completion
does not meet this requirement. Both output flags together select NDJSON.

Read [output](../../reference/output/) for stream shapes and [exit
behavior](../../reference/exit-codes/) for errors and interruption. [Export and
reload](../export-session/) distinguishes document encoding from CLI result
encoding.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
