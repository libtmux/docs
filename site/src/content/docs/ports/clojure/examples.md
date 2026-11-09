---
port: clojure
route: examples
title: Examples
description: Run complete Clojure programs against private tmux servers.
sidebar:
  group: Examples
  order: 1
---

The [quickstart](../) creates a session, renames and splits its window, sends a
shell command, and prints the captured graph and output. Its setup installs
the documented source into an isolated Maven repository. Every view closes
its client and stops the server it created.

The API reference includes complete programs with imports, Tools.deps setup,
an owned-server launcher and expected output:

- [Capture output](../reference/libtmux-core-capture/): send literal input,
  wait for an application output marker, and read the screen.
- [Build a layout](../reference/libtmux-core-split-pane/): split panes, rename a
  window, move its placement and compare physical identity with link identity.
- [Capture concurrently](../reference/libtmux-async-submit/): submit bounded
  work and cancel a wait while checking cleanup.
- [Observe UTF-8 output](../reference/libtmux-control-subscribe/): consume a
  bounded stream and inspect its terminal state.
- [Use core.async](../reference/libtmux-core-async-observe/): stop the adapter
  and continue using its borrowed control connection.

The stream examples require tmux 3.7 or newer. On an older supported tmux,
they print the capability refusal shown beside the expected output.
