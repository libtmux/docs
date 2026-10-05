---
description: Search the fields of discovered workspace documents.
product: workspace
sidebar:
  group: CLI reference
  label: Search workspaces
  order: 16
tableOfContents: true
title: Search workspaces
---

<!-- port:py -->
Search discovered workspace fields with regular expressions or literal strings.
Query terms combine with AND unless `--any` selects OR.

## Find a session name

```console
$ tmuxp search \
    --json \
    --fixed-strings \
    --field session \
    workspace
```

Field prefixes and repeated `--field` restrictions select name, session (`s`),
path (`p`), window (`w`) or pane data. `--ignore-case` ignores case;
`--smart-case` does so only when a pattern has no uppercase. `--word-regexp`
requires whole words and `--invert-match` selects nonmatches.

## Empty and invalid queries

The documented implementation emits no bytes for an empty search result,
including with `--json`. With no query, machine search can print human help and
return normally. An invalid regular expression can also produce no machine
output. Account for these outcomes before parsing stdout as JSON.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/search.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Search the fields of discovered workspace documents. Use literal matching when
the input should be treated as text rather than a regular expression.

## Find a session name

```console
$ tmux-workspace search \
    --json \
    --fixed-strings \
    --field session \
    workspace
```

Repeat `--field` to restrict additional fields. Query terms combine with AND;
`--any` selects OR. `--ignore-case`, `--smart-case`, `--word-regexp`, and
`--invert-match` control matching. Inspect the installed `search --help` for
supported field names and aliases.

<!-- port:go -->
## Regular expressions

The default engine uses Go regular expressions and ASCII word boundaries. Structured pane commands are searched as JSON text. Unsupported regex syntax fails; it does not start another runtime automatically.

`--regex-engine python` explicitly enables lookaround, backreferences and Unicode word boundaries through an installed Python 3.10 or newer interpreter. Ordinary searches do not need that optional runtime.
<!-- /port -->

Check both the exit status and [machine result](../../reference/output/). An
empty successful search and a failed pattern are different outcomes.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
