---
description: Generate completion from command definitions and check native availability.
product: workspace
sidebar:
  group: CLI reference
  label: Shell completion
  order: 22
tableOfContents: true
title: Shell completion
ports:
  py:
    description: Generate completion from the Python parser and track native generator requirements.
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
tmuxp uses the separately installed `shtab` package for experimental completion. The parser entry point is [`tmuxp.cli.create_parser`](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py). Generate a script in an environment that can import both packages, then use the shell-specific installation procedure from the [upstream completion guide](https://tmuxp.git-pull.com/cli/completion/).

<!-- port:py -->There is no native workspace executable to generate completions from in this
prototype. The proposed parser choices provide different generators: Cobra has
command-tree completion and documentation export, clap has completion and
man-page companions, ArgumentParser has completion and documentation tools,
picocli has code generation, and Commander, System.CommandLine, and CLI11 need
their documented tooling or an explicit metadata adapter.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->## Native completion

<!-- /port --><!-- port:ts -->Commander defines the native command graph. The CLI package generates Markdown,
a JSON command catalog, and Bash, Zsh, and Fish completion from those definitions.
`docs:check` compares generated files in CI. Keep option event order when paired
flags share a destination.
<!-- /port --><!-- port:rs -->Clap defines the native command graph. `--generate schema` exports metadata;
`--generate man` renders the root manual. `--generate` also accepts `bash`, `zsh`,
`fish`, `powershell`, and `elvish` through clap_complete. Separate subcommand
manuals are not generated.
<!-- /port --><!-- port:go -->Cobra defines the native command graph. `--command-tree` exports JSON metadata;
`--generate-docs` accepts `markdown`, `man`, or `yaml`.
`--generate-completion` accepts `bash`, `zsh`, `fish`, or `powershell`. Exports
distinguish command-local flags from inherited machine-output options.
<!-- /port --><!-- port:java -->Picocli defines the native command graph. `--generate schema` exports metadata
and `--generate bash` emits completion through its code generator. Other manual
and completion formats are not exposed by the workspace executable.
<!-- /port --><!-- port:cxx -->The local C++ CLI generates Bash, Zsh and Fish completion. Build it through
[installation](../../guides/installation/) and make the resulting
`tmux-workspace` executable available on `PATH`.
<!-- /port --><!-- port:java,cxx -->
<!-- /port --><!-- port:java -->Normal Bash generation writes the script directly. Add `--json` for a versioned
artifact with `"command": "generate"`, `"format": "bash"`, the exact text in
`"script"`, and `"status": "ok"`. `--ndjson` emits that artifact as one
`completed` event with `"sequence": 1` and takes precedence over `--json`.
Schema generation retains its metadata document in every output mode. See the
[native generation contract](https://github.com/libtmux/libtmux-java/blob/887a5e079d38898bdffaad19a7961936eabe1ce0/workspace-cli/README.md#generated-reference-and-development).
<!-- /port --><!-- port:dotnet -->System.CommandLine defines the native command graph. `--generate reference`
exports its metadata; `--generate man`, `bash`, `zsh`, and `fish` render the other
formats. The completion scripts offer command and option names without full
argument context. Spectre.Console owns human presentation separately.
<!-- /port --><!-- port:cxx -->Enable Bash completion in the current shell:
<!-- /port --><!-- port:swift -->ArgumentParser defines the native command graph and supplies
`--generate-completion-script` for shell completion. Manual, DocC, and site
metadata integration remain separate work. Use supported parser APIs for those
exports; private parser reflection is not a stable contract.
<!-- /port -->
<!-- port:py,ts,rs,go,java,dotnet,swift -->Completion is derived from actual command metadata. It must include nested
import commands, local short flags, positional arity, mutually exclusive
<!-- /port --><!-- port:py -->choices, and all-command machine options once implemented. Do not ship a static
completion script for a guessed executable name.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,swift -->choices, and all-command machine options. Verify generated scripts with the installed
executable and target shell.
<!-- /port --><!-- port:cxx -->```console
$ source <(tmux-workspace --generate-completion bash)
```

For Zsh, initialise its completion system and load the generated script:

```console
$ autoload -Uz compinit && compinit && source <(tmux-workspace --generate-completion zsh)
```

For Fish:

```console
$ tmux-workspace --generate-completion fish | source
```

Completion includes nested import commands, command-specific flags, enumerated
values and file paths, including names containing spaces. It does not start
tmux or read workspace files. Dynamic session names and configuration aliases
are not suggested. Add the matching setup command to your shell configuration
to enable completion in later sessions.

This is part of the unreleased native CLI. The documentation exporter remains
separate from shell completion.
<!-- /port -->
See the [command tree](../) and [compatibility
reference](../../reference/compatibility/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
