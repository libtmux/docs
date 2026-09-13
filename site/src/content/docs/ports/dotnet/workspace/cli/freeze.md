---
title: "tmuxp freeze"
description: "Capture a live session as a starting workspace file. A capture records observable session state; it cannot recover the original scripts, plugin intent, comments, or every application state."
port: dotnet
product: workspace
sidebar:
  label: "tmuxp freeze"
  group: "CLI reference"
  order: 11
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Capture a live session as a starting workspace file. A capture records
observable session state; it cannot recover the original scripts, plugin intent,
comments, or every application state.

## Export a named session

After the [installation walkthrough](../../guides/installation/) creates
`workspace-guide`, export it to a new destination:

```console
$ tmuxp freeze \
    -L workspace-guide \
    --workspace-format yaml \
    --save-to captured-workspace.yaml \
    --yes \
    workspace-guide
```

Without a session argument, tmuxp resolves or asks for a live session. Without a
format or destination, it can ask for those choices. `--yes` answers yes/no
questions; it does not supply every missing selection. `--quiet` suppresses explanatory status, but prompts can still occur.
Successful export writes the workspace document to a file, not stdout.
Declining a confirmation can return without saving.

In this reference, an explicit `--save-to` path bypasses the overwrite
confirmation used by the prompted path. Select a new path deliberately. The
native contract applies the same protection to explicit and prompted
destinations and keeps `--force` distinct from `--yes`.

Inspect the capture before reloading. See the [export and reload
workflow](../../guides/export-session/) and the [native machine
output](../../reference/output/) for the distinction between a saved file's
format and a CLI result stream.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `"session_name"` | optional |  |
| `-S` | value; None | pass-through for tmux -S |
| `-L` | value; None | pass-through for tmux -L |
| `-f`, `--workspace-format` | value; None | yaml, json |
| `-o`, `--save-to` | value; None | file to save to |
| `--yes`, `-y` | flag; False | always answer yes |
| `--quiet`, `-q` | flag; False | suppress explanatory/status text; prompts still occur despite the parser help claiming otherwise |
| `--force` | flag; False | overwrite the workspace file |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/freeze.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
