---
title: MCP server
description: Connect an MCP client to an existing tmux endpoint through LibTmuxMCP.
port: julia
product: mcp
sidebar:
  label: Overview
  order: 0
---

`LibTmuxMCP` serves a local tmux endpoint over standard input and output.
Select an existing server explicitly and configure the tools the client
may use. The application leaves the borrowed daemon and existing sessions
running when it closes.

The [server guide](./source-guide/) covers package installation, launcher
creation, endpoint selection and tool permissions. The
[API reference](./reference/) documents the Julia embedding surface.
