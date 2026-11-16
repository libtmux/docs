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

Save the complete program as `Sources/Connect/Connect.swift`. When
`LIBTMUX_SOCKET_PATH` names a socket, `findWork` connects a `Server` to it,
finds `work`, prints the name and leaves that server running.

Without the variable, `demonstrate` starts a private tmux server in a new
temporary directory and creates a detached `work` session in it. It then
connects a second `Server` to the socket by path and runs the same lookup.
Afterward it stops only the private server and removes its directory, also when
the lookup fails. If tmux cannot be stopped, it keeps the directory and prints
its location.

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
        if let socket = environment["LIBTMUX_SOCKET_PATH"], !socket.isEmpty {
            try await findWork(socket: socket)
        } else {
            try await demonstrate()
        }
    }

    static func findWork(socket: String) async throws {
        let server = try Server(socketPath: socket)
        guard try await server.hasSession("=work") else {
            throw ConnectError.failed("The work session does not exist")
        }
        print("work")
    }

    static func demonstrate() async throws {
        let unique = UUID().uuidString.prefix(8)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("libtmux-attach-\(unique)")
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        let socket = directory.appendingPathComponent("tmux.sock").path
        var failure: (any Error)?
        do {
            let server = try Server(
                socketPath: socket, configurationFile: "/dev/null"
            )
            _ = try await server.newSession(named: "work")
            try await findWork(socket: socket)
        } catch {
            failure = error
        }

        var cleanupFailed = false
        if FileManager.default.fileExists(atPath: socket) {
            do { try await Server(socketPath: socket).killServer() }
            catch {
                report("Cannot stop tmux; kept \(directory.path): \(error)")
                cleanupFailed = true
            }
        }
        if !cleanupFailed {
            do { try FileManager.default.removeItem(at: directory) }
            catch {
                report("Cannot remove \(directory.path): \(error)")
                cleanupFailed = true
            }
        }
        if let failure { throw failure }
        if cleanupFailed { throw ConnectError.failed("Cleanup failed") }
    }

    static func report(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.3a or newer installed.

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

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-swift libtmux-source &&
  git -C libtmux-source checkout 254f8b2be7eb60cacc3ffcb3ea8e456784f582df &&
  swift run --jobs 2 Connect
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; the program
leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
