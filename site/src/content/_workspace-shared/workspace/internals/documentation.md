---
description: Keep help, completion, and site references aligned with command metadata.
product: workspace
sidebar:
  group: Internals
  label: Documentation
  order: 80
tableOfContents: true
title: Workspace reference generation
---

<!-- port:py -->This page describes the documentation integration for Python. Native CLI
<!-- /port --><!-- port:dotnet -->This page describes the documentation integration for .NET. Native CLI
<!-- /port --><!-- port:py,dotnet -->references remain compatibility targets until an installed command exists.
<!-- /port --><!-- port:ts -->The native TypeScript CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:rs -->The native Rust CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:go -->The native Go CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:java -->The native Java CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:cxx -->The native C++ CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:swift -->The native Swift CLI derives help and exports from its parser definitions.
<!-- /port --><!-- port:ts,rs,go,java,cxx,swift -->[Compatibility](../../reference/compatibility/) records current coverage.
<!-- /port -->
## Command metadata

<!-- port:py -->tmuxp uses argparse metadata from create_parser for its upstream Sphinx CLI reference. Its separately installed shtab integration consumes that parser for completion. The documentation adapter must preserve required groups rather than infer arity from optional-looking help.
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
<!-- /port --><!-- port:py,ts,rs,go,java -->
<!-- /port --><!-- port:py -->The [command reference](../../cli/) covers the Python grammar. A future native
export must record command paths, aliases, positional arity, option spellings,
<!-- /port --><!-- port:java -->Bash generation also supports a JSON artifact or one completed NDJSON event;
the script remains a string inside the machine result. Schema generation keeps
its metadata document. See [machine completion output](../../cli/completion/).
<!-- /port --><!-- port:dotnet -->System.CommandLine defines the native command graph. `--generate reference`
exports its metadata; `--generate man`, `bash`, `zsh`, and `fish` render the other
formats. The completion scripts offer command and option names without full
argument context. Spectre.Console owns human presentation separately.
<!-- /port --><!-- port:cxx -->CLI11 defines the native command graph. Its filtered `get_subcommands` overload
enumerates command definitions; the unfiltered overload describes parsed commands.
A site exporter and shell completion remain unimplemented.
<!-- /port --><!-- port:swift -->ArgumentParser defines the native command graph and supplies
`--generate-completion-script` for shell completion. Manual, DocC, and site
metadata integration remain separate work. Use supported parser APIs for those
exports; private parser reflection is not a stable contract.
<!-- /port --><!-- port:java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->The [command reference](../../cli/) covers the Python grammar. Native metadata
exports need to record command paths, aliases, positional arity, option spellings,
<!-- /port -->types, defaults, choices, required and exclusive groups, store-constant values,
repeat and ordering behavior, environment bindings, and child commands. Output
schemas and availability belong alongside that metadata.

Generate help, completion, and static reference from the same definitions.
Compare generated results in CI and test actual installed help separately.
A rendered example or successful parser-only probe does not establish service
execution, distribution, or tmux compatibility.

## Site integration

Keep equivalent task pages at the same workspace path in every port. The
existing page switcher offers authored counterparts and leaves absent pages
unavailable. A CLI guide and a builder API guide are different counterparts;
preserve [builder reference](../../reference/) as its own surface.

Write executable shell examples per port. Shared console, YAML, and JSON blocks
survive language filtering. Installing a native library must not be presented
as installing a workspace executable when it has no such artifact.

The site version and workspace package version can differ. Record the package
and source revision independently, and do not use an older version-shaped URL
<!-- port:py -->to imply that today's command existed in an older release. This local research
prototype is reviewed against current source.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->to imply that today's command existed in an older release. The installation
guide identifies the available source builds and published artifacts.
<!-- /port -->
## Verification

Check [configuration](../../configuration/), [machine output](../../reference/output/),
and [compatibility](../../reference/compatibility/) together. Exercise equivalent
page paths, API backlinks, fragments, sidebars, metadata exports, search, and
preview prefixes in assembled output. Verify command examples against isolated
tmux servers, with explicit cleanup and known limitations.
