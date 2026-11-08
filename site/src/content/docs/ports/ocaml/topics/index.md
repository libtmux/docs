---
title: OCaml topics
description: Understand native client operations, streaming and compatibility.
port: ocaml
route: topics
cards:
  - label: Operations and completion
    href: ../guides/control/
    body: Distinguish admission, acknowledgement, completion and uncertainty.
  - label: Streaming and cancellation
    href: ../guides/streaming/
    body: Observe bounded output subscriptions without blocking other clients.
  - label: Compatibility
    href: ../guides/compatibility/
    body: Check qualified platforms, tmux releases and remaining limitations.
---

Client operations perform explicit I/O. Captured observations remain local and
readable after client closure. Follow the guides below for operational
contracts, cancellation and supported environments.
