---
title: "Develop the C++ workspace consumer"
description: "Build and exercise the source-only C++ workspace consumer."
port: cxx
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Try the workspace consumer from the libtmux C++ source checkout. It is built
as a repository target, so installing the core package alone does not provide
its headers or YAML reader.

## Build the consumer

Use the repository's prepared development toolchain and install tmux. From
the checkout root, configure the development preset:

```console
$ cmake --preset cxx-dev
```

Build the workspace test executable:

```console
$ cmake --build --preset cxx-dev --target workspace_builder_test
```

Run the consumer tests against their isolated tmux fixtures:

```console
$ ctest --preset cxx-dev -R consumer.workspace --output-on-failure
```

The tests exercise both YAML parsing and typed configuration. The
[example](../examples/) shows the session shape used by the builder test.

## Use it in an application

The `workspace_builder` CMake target provides the consumer include directory,
links the core [`libtmux::libtmux`](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/CMakeLists.txt) target publicly, and keeps yaml-cpp private
to the YAML reader. If you adapt the consumer, preserve those dependency
boundaries and include the parser implementation when using `parse_tmuxp`.

Parse first and inspect `ParseError` before contacting tmux. Start the target
tmux server before opening its core handle, as the test fixture does. Pass a core
`Server` and the parsed description to `build`. Check the returned expected
value before reading its session; after failure, inspect the target server
because earlier operations may remain.

There is no separate installed workspace product in this source tree. Do not
expect core package managers to expose `libtmux_consumers/workspace.hpp`.

[Consumer build targets](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/CMakeLists.txt)
