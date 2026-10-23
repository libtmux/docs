---
title: tmux MCP for Elixir is not published
description: The Elixir repository contains an MCP package scaffold, not a usable or published server.
port: elixir
product: mcp
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Elixir has no published libtmux MCP server. The repository's `packages/mcp`
directory is a scaffold: its README says the package is under implementation
and has no protocol server or executable yet.

This page records availability so cross-language navigation does not turn a
source placeholder into a product claim. There is no launch command, client
configuration, tool reference, prompt catalog, or embedding reference to use.

Use the [core Elixir library](../guides/overview/) for direct tmux access.
Choose another language's MCP server only as a separate process with that
server's own package, policy, and compatibility requirements.
