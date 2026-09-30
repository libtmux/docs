---
title: "C++ workspace builder examples"
description: "Internal examples for building and inspecting workspaces through the C++ API."
port: cxx
product: workspace
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Build an editor window with two panes and a logs window with one pane on a
private tmux server. This walkthrough uses a POSIX host with tmux, CMake 3.25
or newer, Clang 18, and the libc++ 18 development libraries.

## Create the project

In a new directory, fetch the source revision used by this documentation:

```console
$ mkdir cxx-workspace-example
$ cd cxx-workspace-example
$ git init -q libtmux-source
$ git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-cxx.git
$ git -C libtmux-source fetch --depth=1 origin 393d4b0ad666f18a6581f1eb281741a75a7503f0
$ git -C libtmux-source checkout --detach FETCH_HEAD
```

Save the following build file. The typed builder is a source header; this example
does not use the optional YAML reader. The public testing library supplies
private-server startup and cleanup.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.25)
project(workspace_example LANGUAGES CXX)

set(LIBTMUX_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LIBTMUX_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LIBTMUX_BUILD_TESTING_LIBRARY ON CACHE BOOL "" FORCE)
add_subdirectory(libtmux-source)

add_executable(workspace-example main.cpp)
target_compile_features(workspace-example PRIVATE cxx_std_23)
target_include_directories(workspace-example PRIVATE
    libtmux-source/examples/workspace/include)
target_link_libraries(workspace-example PRIVATE
    libtmux::libtmux libtmux::testing)
```

## Build and inspect

Save this complete program as `main.cpp`:

```cpp title="main.cpp"
#include <iostream>
#include <memory>
#include <stdexcept>

#include "libtmux/server.hpp"
#include "libtmux/testing/scoped_server.hpp"
#include "libtmux_consumers/workspace.hpp"

int main() {
    auto cleanup = std::make_shared<libtmux::test::TeardownReport>();
    bool complete = false;
    try {
        auto owned = libtmux::test::ScopedTmuxServer::start({.teardown_report = cleanup});
        if (!owned) throw std::runtime_error(owned.error());
        auto server = libtmux::Server::at_socket_path(owned->socket_path().string());
        if (!server) throw std::runtime_error(server.error().diagnostic);

        namespace workspace = libtmux::workspace;
        const workspace::Workspace description{
            .session_name = "built",
            .windows = {{.name = "editor", .panes = {{.shell = "/bin/cat"}, {.shell = "/bin/cat"}}},
                        {.name = "logs", .panes = {{.shell = "/bin/cat"}}}}};
        const auto built = workspace::build(*server, description);
        if (!built) throw std::runtime_error(built.error().reason);
        const auto windows = built->windows();
        if (!windows) throw std::runtime_error(windows.error().diagnostic);
        const auto panes = windows->front().panes();
        if (!panes) throw std::runtime_error(panes.error().diagnostic);
        std::cout << built->name() << ": " << windows->size() << " windows\n";
        std::cout << "editor: " << panes->size() << " panes\n";
        complete = true;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
    }
    for (const auto& message : cleanup->messages) {
        if (message != "server teardown complete") {
            std::cerr << message << '\n';
            complete = false;
        }
    }
    return complete ? 0 : 1;
}
```

Configure, build and run from the example directory:

```console
$ cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_COMPILER=clang++-18 -DCMAKE_CXX_FLAGS=-stdlib=libc++
$ cmake --build build --parallel 2 --target workspace-example
$ ./build/workspace-example
```

The program prints `built: 2 windows` and `editor: 2 panes`. The owned fixture
creates a private socket and removes its server and temporary files when the
scope ends, including during exception handling. Each pane runs `/bin/cat`,
which waits for input without loading an interactive shell configuration.

This header belongs to the source consumer. Installing the core package alone
does not supply the workspace include directory. For YAML input, the separate
consumer build also needs its parser and yaml-cpp dependency.

[Workspace builder source](https://github.com/libtmux/libtmux-cxx/blob/393d4b0ad666f18a6581f1eb281741a75a7503f0/examples/workspace/include/libtmux_consumers/workspace.hpp)
