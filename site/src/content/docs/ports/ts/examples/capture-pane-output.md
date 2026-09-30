---
port: ts
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

```typescript title="capture.ts"
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-capture-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"),
  configFile: "/dev/null",
  timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  const signal = AbortSignal.timeout(5_000);
  const session = await server.newSession({
    name: "capture", shellCommand: "sh", signal,
    environment: { ENV: "/dev/null" },
  });
  const pane = session.activePane;
  if (!pane) throw new Error("The session has no active pane");
  await pane.sendKeys("printf '\\nlibtmux capture ready\\n'", { signal });
  for (;;) {
    const lines = await pane.capture({ signal });
    const line = lines.find((line) => line === "libtmux capture ready");
    if (line !== undefined) {
      console.log(line);
      break;
    }
    await delay(20, undefined, { signal });
  }
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(
      `Cleanup failed; inspect ${directory}`, { cause: error },
    ));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Capture failed");
```

Cleanup checks the private socket even if startup fails. If stopping tmux fails,
the error reports the retained directory so the server remains reachable.

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

Save the program as `capture.ts` and this file as `package.json`.
Use Bun 1.4.2 or newer.

```json title="package.json"
{"type":"module","dependencies":{"libtmux":"file:./libtmux/packages/libtmux"}}
```

```console
$ git clone https://github.com/libtmux/libtmux-ts libtmux &&
  git -C libtmux checkout 3fe1ca654b81b8cbf4a13b777a001a3298c87a6f &&
  bun install &&
  bun run capture.ts
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
