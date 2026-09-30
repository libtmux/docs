---
title: Use the TypeScript workspace builder
description: Apply a workspace, review planned changes, and handle partial failures.
port: ts
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Apply a workspace to create or reconcile its session, windows, and panes. Start
with the [complete TypeScript example](../examples/): it includes imports,
project setup, the selected library source, run commands, and private-server
cleanup.

## Create a session

`applyWorkspace` accepts a `Server` and workspace configuration. Await it to
receive the resulting session. Pane commands can still be running when it
returns.

The complete example uses a private socket and registers cleanup before
applying the workspace. A failed apply can leave a session or some of its
windows in place. For a workspace you want to keep, choose the intended server
explicitly and retain the returned session.

## Read configuration

`parseWorkspace` from `@libtmux/workspace/config` validates an object produced
by your chosen JSON or YAML parser. `parseWorkspaceYaml` uses Bun's YAML parser.
Unknown fields fail validation. With another runtime, parse the document first
and pass the resulting object to `parseWorkspace`.

## Review changes and failures

`planWorkspace` reads the server and reports planned structural creation,
removal, retention, and window renames. Options, layouts, focus, and command
effects are outside that plan. Review removals and retained entries, then apply
promptly. Replan after an outside change.

When an apply fails after mutation may have started, `WorkspaceApplyError`
records completed milestones and the failed stage. Its `requiresReplan` flag
is true; rediscover the current structure before retrying. Completed command
effects remain part of the application's recovery decision.

[Topics](../topics/) explains command replay and pruning policies. The
[configuration parser](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/packages/workspace/src/config.ts)
and [builder contracts](https://github.com/libtmux/libtmux-ts/blob/3fe1ca654b81b8cbf4a13b777a001a3298c87a6f/packages/workspace/src/builder.ts)
cover these entry points.
