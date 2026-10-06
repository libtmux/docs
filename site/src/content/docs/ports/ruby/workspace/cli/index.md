---
title: libtmux-workspace CLI manual
description: Commands, options and exit statuses for the Ruby workspace CLI.
port: ruby
product: workspace
sidebar:
  group: CLI reference
  label: CLI Manual
  order: 0
tableOfContents: true
---

`libtmux-workspace` validates a YAML or JSON configuration, shows its creation
plan, and applies it to an explicitly selected tmux server. Install the
workspace gem using the [workspace installation instructions](../../).

## Commands

<dl class="cli-command-list">
  <dt><a href="./validate/"><code>validate</code></a></dt>
  <dd>Check the configuration without contacting tmux or running commands.</dd>
  <dt><a href="./plan/"><code>plan</code></a></dt>
  <dd>Inspect ordered creation operations, optionally using a live snapshot.</dd>
  <dt><a href="./load/"><code>load</code></a></dt>
  <dd>Create a new session on an existing server selected by socket path.</dd>
</dl>

## Input and common options

Pass one configuration file after the options. If you omit the file, discovery
requires exactly one of `.tmuxp.yaml`, [`.tmuxp.yml`](./validate/), or
[`.tmuxp.json`](./validate/) in the current directory. Missing or ambiguous
input exits with status `2`.

| Option | Behavior |
| --- | --- |
| `--json` | Write one JSON result or error to stdout. |
| `--expand-environment` | Expand `${NAME}` in configured paths and environment values using explicit `--env` values. Shell command text stays unchanged. |
| `--env NAME=VALUE` | Supply an expansion value. Repeat for different names; duplicate names are invalid. Ambient environment variables are not the expansion map. |
| `-h`, `--help` | Show commands and options without reading a file or contacting tmux. |
| `--version` | Show the installed gem version without reading a file or contacting tmux. |

Show the installed command's options:

```console
$ libtmux-workspace --help
```

Check the installed version:

```console
$ libtmux-workspace --version
```

The command pages explain `--socket`, `--live`, `--timeout`, `--compensate`,
`--attach`, and `--switch`, including which commands accept them.

## Output and exit statuses

Successful human-readable results go to stdout. Human-readable errors go to
stderr; an application failure can also include its partial creation ledger
there. With `--json`, both results and errors go to stdout as JSON. Check the
exit status as well as the output.

| Status | Meaning |
| --- | --- |
| `0` | The requested operation succeeded. |
| `1` | Execution failed before recorded application effects. |
| `2` | Arguments or configuration are invalid. |
| `3` | Application effects are partial or uncertain, or a post-load attach or switch failed. |
| `130` | The operation was interrupted or cancelled. |

A successful load confirms that the creation operations completed and shell
commands were dispatched. It does not establish that the programs in those
panes have completed. A failed load can leave a session behind; inspect its
result before retrying.

[CLI parser and implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-workspace/lib/libtmux/workspace/cli.rb).
