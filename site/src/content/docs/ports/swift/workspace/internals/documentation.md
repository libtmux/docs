---
title: "Workspace reference generation"
description: "Keep help, completion, and site references aligned with command metadata."
port: swift
product: workspace
sidebar:
  group: Internals
  label: Documentation
  order: 80
tableOfContents: true
---

The native Swift CLI derives help and exports from its parser definitions.
[Compatibility](../../reference/compatibility/) records current coverage.

## Command metadata

ArgumentParser defines the native command graph and supplies
`--generate-completion-script` for shell completion. Manual, DocC, and site
metadata integration remain separate work. Use supported parser APIs for those
exports; private parser reflection is not a stable contract.

The [command reference](../../cli/) covers the Python grammar. Native metadata
exports need to record command paths, aliases, positional arity, option spellings,
types, defaults, choices, required and exclusive groups, store-constant values,
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
preserve [builder reference](../api/) as its own surface.

Write executable shell examples per port. Shared console, YAML, and JSON blocks
survive language filtering. Installing a native library must not be presented
as installing a workspace executable when it has no such artifact.

The site version and workspace package version can differ. Record the package
and source revision independently, and do not use an older version-shaped URL
to imply that today's command existed in an older release. The installation
guide identifies the available source builds and published artifacts.

## Verification

Check [configuration](../../configuration/), [machine output](../../reference/output/),
and [compatibility](../../reference/compatibility/) together. Exercise equivalent
page paths, API backlinks, fragments, sidebars, metadata exports, search, and
preview prefixes in assembled output. Verify command examples against isolated
tmux servers, with explicit cleanup and known limitations.
