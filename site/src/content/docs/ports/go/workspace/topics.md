---
title: "Go workspace topics"
description: "Understand strict parsing, temporary control connections, and partial builds."
port: go
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

`Parse` rejects unknown fields and gathers validation problems with their
source lines. Parse and validation failures match `ErrInvalidWorkspace`.
Errors from tmux while building use the core tmux package's error categories.

## Connection ownership

`Build` creates the first session with a temporary control connection, uses
that connection for construction, and closes it before returning an ordinary
session handle. That connection is a tmux client while it exists: it appears
in client listings, changes attachment counts, and can trigger client hooks.

`BuildInto` uses a session supplied by the caller. The caller owns the
connection and its lifetime. `InitialSessionRequest` lets you create the
initial session with the workspace's settings before populating it.

A returned session from creation does not contain a fresh graph of relations.
Take a server snapshot or use the search operations to inspect the windows
and panes that were built.

## Failures and directories

Building is not transactional. Earlier objects remain if a later operation
fails. Check both the returned session and the error, then decide whether to
inspect or remove the partial session. The builder uses strict errors even
when the supplied server has another error policy.

A missing `start_directory` may make tmux start the pane in its home directory
without failing. `Workspace.MissingDirectories` reports absent paths before
construction; callers decide whether that is an error or something setup
commands will resolve.

## Format differences

Python plugins and `before_script` are rejected. `${VAR}` interpolation is
not performed before building; render such configuration yourself if needed.
`sleep_before` and `sleep_after` are seconds and pause construction between
command deliveries.

Environment entries at every configuration level are written to the session.
If several entries set the same name, the last value remains for later
processes. Global options are applied after the first session exists, so its
first window cannot inherit options that were set later.

[Workspace contracts](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/README.md)
