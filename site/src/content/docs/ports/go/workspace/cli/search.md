---
title: "tmuxp search"
description: "Search discovered workspace fields using regular expressions or literal strings. Queries combine with AND unless `--any` selects OR."
port: go
product: workspace
sidebar:
  label: "tmuxp search"
  group: "CLI reference"
  order: 16
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Search discovered workspace fields using regular expressions or literal strings.
Queries combine with AND unless `--any` selects OR.

## Find workspaces by session name

```console
$ tmuxp search \
    --json \
    --fixed-strings \
    --field session \
    workspace
```

Field prefixes in query terms and repeated `--field` restrictions select name,
session (`s`), path (`p`), window (`w`), or pane data. `--ignore-case` ignores
case; `--smart-case` does so only when a pattern has no uppercase.
`--word-regexp` requires whole words and `--invert-match` selects nonmatches.

JSON results contain `"name"`, `"path"`, `"session_name"`, `"source"`, `matched_fields`,
and `"matches"`. The pinned reference emits an empty byte stream for no matches,
even with `--json`. With no query, machine search can print human help and
return normally. An invalid regular expression can also yield no machine output.
The native contract instead uses `[]` for an empty JSON result and
usage status 2 for a missing or invalid pattern.

Python regular-expression behavior is part of compatibility. Native regex
libraries differ in lookaround, backreferences, Unicode, flags, and word
boundaries. Matching the options alone does not establish expression
equivalence. See [compatibility](../../reference/compatibility/) and
[output](../../reference/output/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `"query_terms"` | zero or more | search patterns (prefix with field: for field-scoped search) |
| `-f`, `--field` | value; None | restrict search to field(s): name, session/s, path/p, window/w, pane |
| `-i`, `--ignore-case` | flag; False | case-insensitive matching |
| `-S`, `--smart-case` | flag; False | case-insensitive unless pattern has uppercase |
| `-F`, `--fixed-strings` | flag; False | treat patterns as literal strings, not regex |
| `-w`, `--word-regexp` | flag; False | match whole words only |
| `-v`, `--invert-match` | flag; False | show workspaces that do NOT match |
| `--any` | flag; False | match ANY pattern (OR logic); default is ALL (AND logic) |
| `--json` | flag; False | output as JSON |
| `--ndjson` | flag; False | output as NDJSON (one JSON per line) |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/search.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
