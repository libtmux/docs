---
port: ts
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with TypeScript.
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

Save the complete program as `connect.ts`. `LIBTMUX_SOCKET_PATH` selects the
existing server: `findWork` connects a new `Server` to that socket, prints the
`work` session and leaves the tmux server running.

Without the variable, the program starts a demonstration server to stand in
for yours. `demonstrate` creates a `work` session on a socket in a new
temporary directory. Its `finally` block stops that server and removes the
directory, including after an error. If tmux does not stop, the error names the
directory the program kept.

```typescript title="connect.ts" role="program"
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "libtmux";

async function findWork(socketPath: string): Promise<void> {
  const server = new Server({ socketPath, timeoutMs: 5_000 });
  const signal = AbortSignal.timeout(5_000);
  const snapshot = await server.snapshot({ signal });
  const session = snapshot.sessions.one({ name: "work" });
  console.log(session.name);
}

async function demonstrate(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "libtmux-attach-"));
  const socketPath = join(directory, "tmux.sock");
  const owner = new Server({
    socketPath, configFile: "/dev/null", timeoutMs: 5_000,
  });
  const failures: unknown[] = [];
  try {
    const signal = AbortSignal.timeout(5_000);
    await owner.newSession({ name: "work", shellCommand: "cat", signal });
    await findWork(socketPath);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if ((await readdir(directory)).includes("tmux.sock")) await owner.kill();
      await rm(directory, { recursive: true });
    } catch (error) {
      failures.push(new Error(
        `Cleanup failed; inspect ${directory}`, { cause: error },
      ));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Attach failed");
}

const socketPath = process.env.LIBTMUX_SOCKET_PATH;
if (socketPath) await findWork(socketPath);
else await demonstrate();
```

## Setup and run

Use an empty directory on Linux with Bun 1.4.2 or newer and tmux 3.3a or
newer installed.

Save this file beside the program using the displayed filename. It installs
`libtmux` 0.1.2 from npm ([source](https://github.com/libtmux/libtmux-ts/tree/9a6b695471fbb77ac1e494b879ee9bc59adc201d)).

```json title="package.json"
{"type":"module","private":true,"dependencies":{"libtmux":"0.1.2"}}
```

Install the library and run the program:

```console
$ bun install &&
  bun run connect.ts
```

The program prints `work`. To attach to a server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket path in the environment of `bun run`. The
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
