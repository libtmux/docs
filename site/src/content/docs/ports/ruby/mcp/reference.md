---
title: Ruby MCP API reference
description: Public libtmux-mcp embedding types and methods.
port: ruby
product: mcp
sidebar:
  label: Language API
  order: 4
---

Require `libtmux/mcp` to embed the server. Imports start no tmux process,
scheduler, or protocol transport. `Application` borrows an
application-owned `LibTmux::Async::Server`; its SDK server and stdio transport
remain on that application's reactor thread.

The declarations below come from the public Ruby inventory, enriched with RBS
signatures, YARD documentation, behavior contracts, and source coordinates at
the selected revision.
