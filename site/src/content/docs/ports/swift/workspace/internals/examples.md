---
title: Swift workspace builder examples
description: Build and inspect a private workspace with a complete Swift program.
port: swift
product: workspace
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Build two windows with two editor panes, inspect a fresh snapshot, then stop
the private tmux server. The example uses `/bin/cat` to keep its panes open
without reading shell startup files or requiring another application.

## Prepare the project

Use Swift 6.2.4, Git, and tmux 3.2a or newer on Linux. Create an empty project
and the executable's source directory:

```console
$ mkdir swift-workspace-example && cd swift-workspace-example && \
  mkdir -p Sources/WorkspaceExample
```

Fetch the library revision used by this example:

```console
$ git init libtmux-source && \
  git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-swift.git && \
  git -C libtmux-source fetch --depth=1 origin 254f8b2be7eb60cacc3ffcb3ea8e456784f582df && \
  git -C libtmux-source checkout --detach FETCH_HEAD
```

Save the following package manifest at the project root:

```swift title="Package.swift"
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "WorkspaceExample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "libtmux-source")],
    targets: [
        .executableTarget(
            name: "WorkspaceExample",
            dependencies: [
                .product(name: "LibTmux", package: "libtmux-source"),
                .product(name: "TmuxWorkspace", package: "libtmux-source"),
            ]
        ),
    ]
)
```

<a id="describe-and-build"></a>

## Run the complete program

Save this file in the source directory created above. Its private socket is
checked during cleanup even when startup fails. Cleanup failures preserve the
original error and report the retained directory.

```swift title="Sources/WorkspaceExample/WorkspaceExample.swift"
import Foundation
import LibTmux
import TmuxWorkspace

struct ExampleFailure: Error, CustomStringConvertible {
    let description: String
}

func withPrivateTmux(
    _ body: @Sendable (Server) async throws -> Void
) async throws {
    let directory = URL(fileURLWithPath: "/tmp")
        .appendingPathComponent("libtmux-swift-example-\(UUID().uuidString)")
    let server = try Server(
        socketPath: directory.appendingPathComponent("s").path,
        configurationFile: "/dev/null"
    )
    try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    var failures: [String] = []
    do { try await body(server) }
    catch { failures.append("Operation: \(error)") }
    do {
        let files = try FileManager.default.contentsOfDirectory(
            atPath: directory.path
        )
        if files.contains("s") { try await server.killServer() }
        try FileManager.default.removeItem(at: directory)
    } catch {
        failures.append("Cleanup at \(directory.path): \(error)")
    }
    if !failures.isEmpty {
        throw ExampleFailure(description: failures.joined(separator: "\n"))
    }
}

@main
struct WorkspaceExample {
    static func main() async throws {
        try await withPrivateTmux { server in
            let started = try await server.run([
                TmuxCommand("set-option", ["-g", "default-shell", "/bin/sh"]),
                TmuxCommand("set-option", ["-g", "default-command", "exec /bin/cat"]),
                TmuxCommand("set-environment", ["-g", "ENV", ""]),
                TmuxCommand("set-environment", ["-g", "BASH_ENV", ""]),
                TmuxCommand("new-session", ["-d", "-s", "bootstrap"]),
            ])
            guard started.isSuccess else {
                throw ExampleFailure(description: started.errorText)
            }
            let workspace = Workspace(
                sessionName: "workspace-example",
                windows: [
                    WindowPlan(
                        windowName: "editor", layout: "even-horizontal",
                        panes: [PanePlan(), PanePlan()]
                    ),
                    WindowPlan(windowName: "logs", panes: [PanePlan()]),
                ]
            )
            let session = try await WorkspaceBuilder.build(workspace, on: server)
            let snapshot = try await server.snapshot()
            let windows = snapshot.windows(of: session)
            guard windows.count == 2,
                let editor = windows.first(where: { $0.name == "editor" }),
                snapshot.panes(of: editor).count == 2
            else {
                throw ExampleFailure(description: "Unexpected workspace layout")
            }
            print("built: \(windows.count) windows")
            print("editor: \(snapshot.panes(of: editor).count) panes")
        }
    }
}
```

<a id="verification"></a>

Build and run the executable:

```console
$ swift run --jobs 2 WorkspaceExample
```

Expected output:

```text
built: 2 windows
editor: 2 panes
```

The bootstrap session keeps tmux alive while the builder checks for an
existing session. The program sets its default command before creating the
workspace. A fresh snapshot verifies the completed layout: the value returned
when its first session is created does not include later window additions.

Describe panes with Swift values or decode a configuration with
`Workspace.decode(json:)`. The [guide](../guides/) explains ownership,
configuration input and failed-build cleanup.

[Library source](https://github.com/libtmux/libtmux-swift/tree/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/TmuxWorkspace).
