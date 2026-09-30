---
port: cxx
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

```cpp title="capture.cpp"
#include <chrono>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>

#include <libtmux/libtmux.hpp>
#include <libtmux/testing/scoped_server.hpp>

int main() {
  auto cleanup = std::make_shared<libtmux::test::TeardownReport>();
  bool captured = false;
  try {
    // This public fixture owns a private socket, uses /dev/null as its
    // tmux configuration, and stops its server when the scope ends.
    auto owned = libtmux::test::ScopedTmuxServer::start({
        .session_name = "capture",
        .socket_namespace = libtmux::test::SocketNamespace::consumer("capture"),
        .teardown_report = cleanup,
    });
    if (!owned) throw std::runtime_error(owned.error());
    auto server = libtmux::Server::at_socket_path(owned->socket_path());
    if (!server) throw std::runtime_error(server.error().diagnostic);
    auto panes = server->panes();
    if (!panes) throw std::runtime_error(panes.error().diagnostic);
    if (panes->empty()) throw std::runtime_error("The session has no pane");
    const auto& pane = panes->front();

    auto sent = pane.send_line("printf '\\nlibtmux capture ready\\n'");
    if (!sent) throw std::runtime_error(sent.error().diagnostic);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{5};
    while (std::chrono::steady_clock::now() < deadline && !captured) {
      auto text = pane.capture();
      if (!text) throw std::runtime_error(text.error().diagnostic);
      std::istringstream lines{*text};
      for (std::string line; std::getline(lines, line);) {
        if (line == "libtmux capture ready") {
          std::cout << line << '\n';
          captured = true;
          break;
        }
      }
      if (!captured) std::this_thread::sleep_for(std::chrono::milliseconds{25});
    }
    if (!captured) {
      throw std::runtime_error("Output did not arrive within five seconds");
    }
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    captured = false;
  }
  for (const auto& message : cleanup->messages) {
    if (message != "server teardown complete") {
      std::cerr << message << '\n';
      captured = false;
    }
  }
  return captured ? 0 : 1;
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

Save the program as `capture.cpp` and this file as `CMakeLists.txt`. Use CMake
3.25 or newer, Ninja, and Clang 18 with libc++ 18 on Linux. The public testing
library supplies the private server's lifetime management; it is linked explicitly below.

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.25)
project(capture_example LANGUAGES CXX)
set(LIBTMUX_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LIBTMUX_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LIBTMUX_BUILD_TESTING_LIBRARY ON CACHE BOOL "" FORCE)
add_subdirectory(libtmux-source)
add_executable(capture capture.cpp)
target_compile_features(capture PRIVATE cxx_std_23)
target_link_libraries(capture PRIVATE libtmux::libtmux libtmux::testing)
```

```console
$ git clone https://github.com/libtmux/libtmux-cxx libtmux-source &&
  git -C libtmux-source checkout 393d4b0ad666f18a6581f1eb281741a75a7503f0 &&
  cmake -S . -B build -G Ninja \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_CXX_FLAGS=-stdlib=libc++ \
    -DCMAKE_EXE_LINKER_FLAGS=-stdlib=libc++ &&
  cmake --build build --target capture --parallel 2 &&
  ./build/capture
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
