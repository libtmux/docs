---
port: py
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Python.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves that server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `connect.py`. `LIBTMUX_SOCKET_PATH` selects the
existing server: `find_work` connects a new `Server` to that socket, prints the
`work` session and leaves the tmux server running.

Without the variable, the program starts a demonstration server to stand in
for yours. `demonstrate` creates a `work` session on a socket in a new
temporary directory. Its `finally` block stops that server and removes the
directory, including after an error. If tmux does not stop, the error names the
directory the program kept.

```python title="connect.py"
import os
import shutil
from pathlib import Path
from tempfile import mkdtemp

import libtmux

def find_work(socket_path):
    server = libtmux.Server(socket_path=socket_path)
    session = server.sessions.get(session_name="work")
    print(session.session_name)

def demonstrate():
    directory = Path(mkdtemp(prefix="libtmux-attach-"))
    owner = libtmux.Server(
        socket_path=directory / "tmux.sock", config_file="/dev/null"
    )
    try:
        owner.new_session(session_name="work", window_command="cat")
        find_work(owner.socket_path)
    finally:
        try:
            owner.kill()
        except Exception as error:
            raise RuntimeError(f"Cannot stop tmux; kept {directory}") from error
        shutil.rmtree(directory)

socket_path = os.environ.get("LIBTMUX_SOCKET_PATH")
if socket_path:
    find_work(socket_path)
else:
    demonstrate()
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Python 3.14.6.

Fetch the verified library revision, build, and run:

```console
$ uv run \
    --with 'libtmux @ git+https://github.com/tmux-python/libtmux@9fdd083a8181a827889337b63cd4e6daea661a8c' \
    connect.py
```

The program prints `work`. To attach to a server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket path in the environment of `uv run`. The
program then starts no server and leaves yours running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a program that sends input and captures output, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
