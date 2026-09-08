---
title: "Python workspace examples"
description: "A tmuxp source workspace and an isolated Python builder example."
port: py
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The upstream workspace examples are YAML and JSON files that can be loaded
with the tmuxp CLI. Start with the two-pane file in the [guide](../guides/),
then use the Python builder when your application needs direct access to the
resulting libtmux session.

## Build from Python data

Run this inside an environment containing tmuxp and its compatible libtmux
dependency. The example expands shorthand and inherited defaults before
calling the classic builder, then removes its dedicated server.

```python
from uuid import uuid4

import libtmux
from tmuxp.workspace import loader
from tmuxp.workspace.builder import WorkspaceBuilder

config = {
    "session_name": "workspace-example",
    "windows": [
        {"window_name": "editor", "panes": ["echo ready", "echo ready"]}
    ],
}
expanded = loader.trickle(loader.expand(config))
server = libtmux.Server(socket_name=f"workspace-{uuid4().hex}")
try:
    builder = WorkspaceBuilder(session_config=expanded, server=server)
    builder.build()
    print(builder.session.name)
    print(len(builder.session.windows))
finally:
    server.kill()
```

The builder stores the resulting session on `ClassicWorkspaceBuilder.session`. Its `build`
method does not return that session as the return value. The code uses a new
socket for each run so cleanup cannot select a normal user server.

## Verification and further examples

The example combines the loader sequence used by the CLI with the classic
builder's documented API. The upstream builder tests exercise its expanded
configuration contract, and freezer tests cover reading live sessions back
into configuration.

Read the upstream [configuration examples](https://tmuxp.git-pull.com/configuration/examples/)
for focus, layouts, directories, environment values, and command shorthand.
Those examples depend on their commands and paths; inspect each file before
loading it on your own server.

[Builder examples and contract](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [Builder tests](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/tests/workspace/test_builder.py).
