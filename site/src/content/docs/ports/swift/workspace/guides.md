---
title: "Build a Swift workspace"
description: "Select TmuxWorkspace in SwiftPM and build a session through an async Server."
port: swift
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Add `TmuxWorkspace` and `LibTmux` to a SwiftPM target. This isolated example
also uses the public `TmuxFixture` product for server startup and cleanup. The
following dependency selects the source revision used by these examples:

```swift
.package(
    url: "https://github.com/libtmux/libtmux-swift.git",
    revision: "46b003c3606e03f1e4ce1ecfc92d87748e4c2095"
)
```

Add the products to the target's dependencies:

```swift
.product(name: "LibTmux", package: "libtmux-swift"),
.product(name: "TmuxWorkspace", package: "libtmux-swift"),
.product(name: "TmuxFixture", package: "libtmux-swift")
```

Use the toolchain specified by the port's package manifest and install tmux.
For YAML input, enable `traits: ["YAMLWorkspaces"]` on the package dependency.
Swift values and JSON need no trait.

## Build an isolated session

Place this entry point in your executable target. `withTmuxServer` starts a
private server and removes it after the closure, including when building
throws. The workspace builder needs a running server for its initial session
lookup.

```swift
import LibTmux
import TmuxFixture
import TmuxWorkspace

@main
struct WorkspaceGuide {
    static func main() async throws {
        try await withTmuxServer { @Sendable server in
            let workspace = Workspace(
                sessionName: "guide",
                windows: [WindowPlan(
                    windowName: "editor",
                    panes: [PanePlan(), PanePlan()]
                )]
            )
            let session = try await WorkspaceBuilder.build(workspace, on: server)
            print(session.name)
        }
    }
}
```

Run the executable through SwiftPM:

```console
$ swift run
```

## Read configuration

Use `Workspace.decode(json:)` with `Data`, or `Workspace.decode(yaml:)` with a
string when the YAML trait is enabled. Review unsupported fields before
moving a Python workspace to this structural subset.

The fixture removes the server after inspecting the session name. In an
application, pass an already running server and retain the result instead. A
build failure triggers the builder's own cleanup attempt; inspect
`rollbackFailed` because it reports that the cleanup also failed.

[Package products and toolchain](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Package.swift); [Build contract](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Sources/TmuxWorkspace/WorkspaceBuilder.swift).

[Isolated server fixture](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Tests/TmuxFixture/TmuxFixture.swift).
