---
port: cxx
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with C++.
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

Save the complete program as `connect.cpp`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```cpp title="connect.cpp"
#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include <libtmux/libtmux.hpp>

int main() {
  try {
    const char* socket = std::getenv("LIBTMUX_SOCKET_PATH");
    if (!socket) throw std::runtime_error("Set LIBTMUX_SOCKET_PATH to an existing socket");
    auto server = libtmux::Server::at_socket_path(socket);
    if (!server) throw std::runtime_error(server.error().diagnostic);
    auto sessions = server->sessions();
    if (!sessions) throw std::runtime_error(sessions.error().diagnostic);
    for (const auto& session : *sessions) {
      if (session.name() == "work") {
        std::cout << "work\n";
        return 0;
      }
    }
    throw std::runtime_error("The work session does not exist");
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Clang 18, libc++ 18, CMake 3.25+.

Use CMake 3.25 or newer, Ninja, and Clang 18 with libc++ 18.

Save this file beside the program using the displayed filename.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.25)
project(connect_example LANGUAGES CXX)
set(LIBTMUX_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LIBTMUX_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory(libtmux-source)
add_executable(connect connect.cpp)
target_compile_features(connect PRIVATE cxx_std_23)
target_link_libraries(connect PRIVATE libtmux::libtmux)
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-cxx-attach.XXXXXX")
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
$ git clone https://github.com/libtmux/libtmux-cxx libtmux-source &&
  git -C libtmux-source checkout 393d4b0ad666f18a6581f1eb281741a75a7503f0 &&
  cmake -S . -B build -G Ninja \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_CXX_FLAGS=-stdlib=libc++ \
    -DCMAKE_EXE_LINKER_FLAGS=-stdlib=libc++ &&
  cmake --build build --target connect --parallel 2 &&
  sh run.sh ./build/connect
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
