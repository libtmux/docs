---
title: "Swift workspace examples"
description: "Compiled examples for describing, building, and decoding workspaces."
port: swift
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The port's `ExampleCode` package contains functions for describing a workspace
in Swift, building it, and reading JSON or YAML. Its tests compile and call
those functions.

## Describe and build

The example's YAML reader requires the dependency's `YAMLWorkspaces` trait.
That trait enables the API inside the dependency; it does not define the same
compilation condition in a consumer package.

```swift file="Examples/Sources/ExampleCode/Workspaces.swift"
```

The log pane expects a log file at the configured path. Change that command
to match the application before using the description as a launcher. The
returned session is a captured value; request a fresh server snapshot to
inspect membership after all windows have been created.

The [guide](../guides/) provides an isolated executable and cleanup. These
helper functions accept a caller-owned server and keep the workspace running
for that caller to use.

## Verification

From a prepared source checkout, run the example package:

```console
$ swift test --package-path Examples
```

The port also checks correspondence between these source functions and its
README examples. Source inclusion in this page keeps the excerpt current;
it does not run the Swift tests during site rendering.

[Example source](https://github.com/libtmux/libtmux-swift/blob/46b003c3606e03f1e4ce1ecfc92d87748e4c2095/Examples/Sources/ExampleCode/Workspaces.swift)
