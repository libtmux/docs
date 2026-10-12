---
port: swift
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Swift.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves the tmux server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `Sources/Connect/Connect.swift`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```swift title="Connect.swift"
import Foundation
import LibTmux

enum ConnectError: Error {
    case failed(String)
}

@main
struct Connect {
    static func main() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let socket = environment["LIBTMUX_SOCKET_PATH"] else {
            throw ConnectError.failed(
                "Set LIBTMUX_SOCKET_PATH to an existing socket"
            )
        }
        let server = try Server(socketPath: socket)
        guard try await server.hasSession("=work") else {
            throw ConnectError.failed("The work session does not exist")
        }
        print("work")
    }
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Swift 6.2.4.

Save this file beside the program using the displayed filename.

```swift title="Package.swift"
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "ConnectExample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "libtmux-source")],
    targets: [
        .executableTarget(
            name: "Connect",
            dependencies: [.product(name: "LibTmux", package: "libtmux-source")]
        ),
    ]
)
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-swift-attach.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-swift libtmux-source &&
  git -C libtmux-source checkout 254f8b2be7eb60cacc3ffcb3ea8e456784f582df &&
  sh run.sh swift run --jobs 2 Connect
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
That launcher is responsible for the demonstration server's lifetime.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
