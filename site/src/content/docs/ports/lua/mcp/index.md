---
title: MCP for Lua is not published
description: The Lua repository contains an MCP scaffold, not a usable or published server.
port: lua
product: mcp
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Lua has no published libtmux MCP server. The repository's MCP directory is a
scaffold: it does not provide an installable server, executable, protocol
catalog, or supported tool API.

This page records availability so cross-language navigation does not turn a
source placeholder into a product claim. There is no launch command, client
configuration, tool reference, prompt catalog, or embedding reference to use.

Use the Lua core library for direct tmux access through its luv or Neovim
runtime. Choose another language's MCP server only as a separate process with
that server's own package, policy, and compatibility requirements.
