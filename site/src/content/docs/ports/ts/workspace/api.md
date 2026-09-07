---
title: "TypeScript workspace API"
description: "Reference entry points for workspace parsing, planning, application, and errors."
port: ts
product: workspace
sidebar:
  label: API
  order: 4
tableOfContents: true
---

Import planning and application from `@libtmux/workspace`, and parsers from
`@libtmux/workspace/config`. Application operates
on a core libtmux `Server` supplied by the caller; creating that server does
not choose a workspace or apply one automatically.

## Parse and validate

[`parseWorkspace`](/reference/ts/config-parseworkspace/) validates data already
read by your application.
[`parseWorkspaceYaml`](/reference/ts/config-parseworkspaceyaml/)
adds Bun's YAML parsing. Both produce the workspace configuration consumed by
the builder.

## Plan and apply

[`planWorkspace`](/reference/ts/builder-planworkspace/) returns a description
of membership changes. [`WorkspacePlan`](/reference/ts/planning-workspaceplan/)
records creations, removals, renames, and retained surplus.

[`applyWorkspace`](/reference/ts/builder-applyworkspace/) performs the work and
resolves to the resulting `Session`. Its options control pruning and whether
commands run in existing panes. Planning accepts pruning policy; command
policy belongs to application.

## Handle failure

[`WorkspaceApplyError`](/reference/ts/builder-workspaceapplyerror/) preserves
the cause and completed milestones. Reinspect tmux before retrying; the error
is not a transaction log of every effect or a receipt for shell commands.

The language API builds workspaces directly. Availability through an MCP
server is a separate protocol capability; consult this port's
[MCP section](../../mcp/) for its advertised tools.

[Public exports](https://github.com/libtmux/libtmux-ts/blob/1ecdab14e15764bfdc5e23c5060f45512a0991f2/packages/workspace/package.json)
