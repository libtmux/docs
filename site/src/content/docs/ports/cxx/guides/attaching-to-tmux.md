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

Save the complete program as `connect.cpp`. When `LIBTMUX_SOCKET_PATH` names a
socket, `find_work` connects a `Server` to it, finds `work`, prints the name and
leaves that server running.

Without the variable, the program starts a private tmux server in a new
temporary directory and creates a detached `work` session in it. It then
connects a second `Server` to the socket by path and runs the same lookup. The
private server's destructor stops only the private server and removes its
directory, also when the lookup throws. If tmux cannot be stopped, it keeps the
directory, prints its location and makes the program exit with status 1.

```cpp title="connect.cpp" role="program"
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <system_error>

#include <libtmux/libtmux.hpp>

namespace fs = std::filesystem;

void find_work(const std::string& socket) {
  auto server = libtmux::Server::at_socket_path(socket);
  if (!server) throw std::runtime_error(server.error().diagnostic);
  auto sessions = server->sessions();
  if (!sessions) throw std::runtime_error(sessions.error().diagnostic);
  for (const auto& session : *sessions) {
    if (session.name() == "work") {
      std::cout << "work\n";
      return;
    }
  }
  throw std::runtime_error("The work session does not exist");
}

// Stops the private server and removes its directory when it leaves scope,
// including while an exception unwinds. A server that will not stop keeps
// its directory, and `status` becomes 1.
struct PrivateServer {
  fs::path directory;
  std::optional<libtmux::Server> server;
  int& status;

  ~PrivateServer() {
    if (server && server->is_alive() && !server->kill()) {
      std::cerr << "Cannot stop tmux; kept " << directory << '\n';
      status = 1;
      return;
    }
    std::error_code error;
    fs::remove_all(directory, error);
    if (error) {
      std::cerr << "Cannot remove " << directory << '\n';
      status = 1;
    }
  }
};

int main() {
  int status = 0;
  try {
    const char* existing = std::getenv("LIBTMUX_SOCKET_PATH");
    if (existing && *existing) {
      find_work(existing);
      return 0;
    }
    auto pattern =
        (fs::temp_directory_path() / "libtmux-attach-XXXXXX").string();
    if (!mkdtemp(pattern.data())) {
      throw std::runtime_error("Cannot create a temporary directory");
    }
    PrivateServer demo{pattern, std::nullopt, status};
    const auto socket = (demo.directory / "tmux.sock").string();
    auto server = libtmux::Server::startable_at_socket_path(
        socket, fs::path{"/dev/null"});
    if (!server) throw std::runtime_error(server.error().diagnostic);
    demo.server = *server;
    auto session =
        server->new_session({.name = "work", .shell_command = "/bin/cat"});
    if (!session) throw std::runtime_error(session.error().diagnostic);
    find_work(socket);
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    status = 1;
  }
  return status;
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.3a or newer installed.

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

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-cxx libtmux-source &&
  git -C libtmux-source checkout 393d4b0ad666f18a6581f1eb281741a75a7503f0 &&
  cmake -S . -B build -G Ninja \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_CXX_FLAGS=-stdlib=libc++ \
    -DCMAKE_EXE_LINKER_FLAGS=-stdlib=libc++ &&
  cmake --build build --target connect --parallel 2 &&
  ./build/connect
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
