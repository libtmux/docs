---
title: "C++ workspace examples"
description: "Use the tested typed description from the workspace consumer."
port: cxx
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The consumer's builder test creates an editor window with two panes and a logs
window with one pane. It uses `ScopedTmuxServer` to isolate and clean up tmux.

## Describe two windows

With `libtmux_consumers/workspace.hpp` included and a core `Server` named
`server`, this is the description used by the real-tmux test:

```cpp
namespace workspace = libtmux::workspace;

const workspace::Workspace description{
    .session_name = "built",
    .windows = {{.name = "editor", .panes = {{}, {}}},
                {.name = "logs", .panes = {{}}}}};
const auto built = workspace::build(server, description);
if (!built.has_value()) {
    throw std::runtime_error(built.error().reason);
}
```

The error-handling line needs `<stdexcept>`. The consumer headers and
`workspace_builder` target come from the source checkout. For a complete
isolated setup, run the linked test rather than targeting your normal server.

## YAML and command checks

`tmuxp_test.cpp` reads command shorthand and mappings, reports unsupported
fields, and verifies the resulting values. `workspace_test.cpp` checks live
windows and panes, command delivery under non-default pane indexes,
environment values, and text sent without Enter.

Run both groups with the [consumer guide](../guides/). These tests exercise
the consumer's public use of libtmux; they do not make its workspace types part
of the installed core package.

[Builder test](https://github.com/libtmux/libtmux-cxx/blob/3770a3f83d73aeb4af01c25c3d817733fa558c99/examples/workspace/tests/workspace_test.cpp); [YAML tests](https://github.com/libtmux/libtmux-cxx/blob/3770a3f83d73aeb4af01c25c3d817733fa558c99/examples/workspace/tests/tmuxp_test.cpp).
