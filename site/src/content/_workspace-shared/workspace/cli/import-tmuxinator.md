---
description: Translate a tmuxinator workspace into tmuxp configuration, preserving an explicit boundary around dynamic Ruby configuration.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp import tmuxinator
  order: 20
tableOfContents: true
title: tmuxp import tmuxinator
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Translate a tmuxinator workspace into tmuxp configuration, preserving an
explicit boundary around dynamic Ruby configuration.

## Select an existing source

With [`project.yml`](../../guides/discovery/) already present in the configured tmuxinator directory:

```console
$ tmuxp import tmuxinator project
```

`TMUXINATOR_CONFIG` overrides the source directory and expands a leading tilde.
A source argument is effectively required, and omission exits 2 despite
optional-looking help. The reference previews and saves the transformed document
interactively.

Do not interpret successful YAML parsing as support for ERB templates or
arbitrary Ruby execution. Native importers must either implement a documented
bridge or reject unsupported dynamic input. Inspect the resulting commands and
directories before loading. See [environment](../../configuration/environment/)
and [output](../../reference/output/).

An extensionless name searches the configured source directory. A filename
with an extension is resolved relative to the current directory unless you
provide an explicit path.

<!-- port:dotnet -->## Native .NET translation
<!-- /port --><!-- port:cxx -->## Native C++ translation
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->`tmux-workspace import tmuxinator` keeps a shorthand window command list in
one pane, with commands delivered in order. An explicit `panes` list creates
separate panes; a command list inside one item still belongs to that pane.
Named pane mappings are refused because the native workspace cannot preserve
their titles.
<!-- /port --><!-- port:cxx -->`tmux-workspace import tmuxinator` translates session names, project roots,
named windows, layouts and pane commands. A command array used as a window
body remains one pane with ordered commands; explicit panes may each contain
a command array.
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->Project `pre_window` groups join with `; ` and run in each pane. Window `pre`
groups join with ` && ` before that window's pane commands and require explicit
nonempty panes. Project `pre` and launcher lifecycle hooks are refused: their
launcher-shell timing cannot be preserved as pane commands. The importer
accepts `rbenv` or `rvm` selectors as a per-pane prefix when no `pre_window`
group is also selected.
<!-- /port --><!-- port:cxx -->`pre_window` arrays join with `; `, while window `pre` arrays join with ` && `.
A nonempty window `pre` requires explicit nonempty panes. Synchronization is
supported only with `synchronize: after`. Host lifecycle hooks, ERB templates,
named pane titles, startup selectors and endpoint/attachment settings are
refused before saving.
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->`synchronize: true` and `synchronize: before` enable window synchronization
before commands; `synchronize: after` enables it after initial commands.
`false`, `off` and `0` do not enable synchronization through the import.
Before synchronization can broadcast commands to panes created earlier in
the window.

The aliases `project_name`, `project_root`, `tabs`, `pre_tab` and `cli_args`
are accepted for `name`, `root`, `windows`, `pre_window` and `tmux_options`.
`socket_name` is preserved. `tmux_options` accepts only `-f PATH`, which selects
the tmux configuration file. Other options, conflicting non-null aliases and
unsupported fields are refused before saving. See
[native import saving](../import/#native-net-imports) for roots and output.
<!-- /port --><!-- port:cxx -->Relative project roots resolve where import runs; relative window roots
resolve against the project root. Saved paths are absolute. `project_name`,
`project_root` and `tabs` aliases use non-null fallback and refuse conflicts.
See [native import saving](../import/#native-c-imports).
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port -->## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | effectively required | `nargs="?"` belongs to a required exclusive group; omission exits 2. Source lookup honors `TMUXINATOR_CONFIG`. |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
