---
port: py
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete program that captures a pane and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

This complete program creates a private tmux server, captures its output, and
cleans up. Follow the [setup and run instructions](#setup-and-run) below. You need
tmux and a Unix environment; no existing tmux session is required.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its output.

```python title="capture.py"
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic, sleep

import libtmux

with TemporaryDirectory(prefix="libtmux-capture-") as directory:
    server = libtmux.Server(
        socket_path=Path(directory) / "tmux.sock",
        config_file="/dev/null",
    )
    try:
        session = server.new_session(
            session_name="capture",
            window_command="sh",
            environment={"ENV": "/dev/null"},
        )
        pane = session.active_window.active_pane
        pane.send_keys("printf '\\nlibtmux capture ready\\n'", literal=True)

        deadline = monotonic() + 5
        while True:
            lines = pane.capture_pane()
            if "libtmux capture ready" in lines:
                print("\n".join(lines))
                break
            if monotonic() >= deadline:
                raise TimeoutError("The pane did not print the expected line")
            sleep(0.05)
    finally:
        server.kill()
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program as `capture.py`. With Python 3.10 or newer and uv installed:

```console
$ uv run \
    --with 'libtmux @ git+https://github.com/tmux-python/libtmux@9fdd083a8181a827889337b63cd4e6daea661a8c' \
    capture.py
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
