---
port: swift
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

```swift title="Capture.swift"
import Foundation
import LibTmux

enum CaptureError: Error {
    case failed(String)
}

@main
struct Capture {
    static func main() async throws {
        let directory = URL(fileURLWithPath: "/tmp/libtmux-swift-dev")
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let server = try Server(
            socketPath: directory.appendingPathComponent("tmux.sock").path,
            configurationFile: "/dev/null"
        )
        var started = false
        var failure: (any Error)?
        do {
            let created = try await server.run(TmuxCommand(
                "new-session",
                ["-d", "-s", "capture", "env -u ENV -u BASH_ENV /bin/sh"]
            ))
            guard created.isSuccess else {
                throw CaptureError.failed(created.errorText)
            }
            started = true
            guard let pane = try await server.panes().first else {
                throw CaptureError.failed("The session has no pane")
            }
            let command = "printf '\\nlibtmux capture ready\\n'"
            try await server.run(command, in: pane)
            let clock = ContinuousClock()
            let deadline = clock.now.advanced(by: .seconds(5))
            var captured = false
            while clock.now < deadline {
                let lines = try await server.capture(pane)
                if lines.contains("libtmux capture ready") {
                    print("libtmux capture ready")
                    captured = true
                    break
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            guard captured else {
                throw CaptureError.failed(
                    "Output did not arrive within five seconds"
                )
            }
        } catch {
            failure = error
        }

        let stderr = FileHandle.standardError
        var cleanupFailed = false
        if started {
            do { try await server.killServer() }
            catch {
                stderr.write(Data("Stop tmux: \(error)\n".utf8))
                cleanupFailed = true
            }
        }
        do { try FileManager.default.removeItem(at: directory) }
        catch {
            stderr.write(Data("Remove socket: \(error)\n".utf8))
            cleanupFailed = true
        }
        if let failure { throw failure }
        if cleanupFailed {
            throw CaptureError.failed("Cleanup failed; see diagnostics")
        }
    }
}
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

Save the program as `Sources/Capture/Capture.swift` and this file as
`Package.swift`. Use Swift 6.2 or newer.

```swift title="Package.swift"
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CaptureExample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "libtmux-source")],
    targets: [
        .executableTarget(
            name: "Capture",
            dependencies: [.product(name: "LibTmux", package: "libtmux-source")]
        ),
    ]
)
```

```console
$ git clone https://github.com/libtmux/libtmux-swift libtmux-source &&
  git -C libtmux-source checkout 254f8b2be7eb60cacc3ffcb3ea8e456784f582df &&
  swift run --jobs 2 Capture
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
