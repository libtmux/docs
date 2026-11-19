---
port: ruby
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Ruby.
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

Save the complete program as `connect.rb`. `LIBTMUX_SOCKET_PATH` selects the
existing server, and `print_work` connects a `Server` to it and finds `work`.
Without the variable, the program starts a private server of its own with
[`LibTmux::Server.start`](../../reference/libtmux-server-start/), creates
`work` with [`new_session`](../../reference/libtmux-server-new_session/),
and connects a second `Server` to that socket by path. Leaving the `start`
block stops the private server and removes its socket directory, including
after an error. A server that does not stop raises an error.

```ruby title="connect.rb"
require "libtmux"

def print_work(socket_path)
  LibTmux::Server.open(socket_path: socket_path) do |server|
    sessions = server.snapshot.sessions
    session = sessions.find { |candidate| candidate.name == "work" }
    raise "The work session does not exist" unless session
    puts session.name
  end
end

socket_path = ENV["LIBTMUX_SOCKET_PATH"]
if socket_path
  print_work(socket_path)
else
  # No server was named: start one this program owns.
  LibTmux::Server.start do |owner|
    owner.new_session(name: "work", command: ["/bin/cat"])
    print_work(owner.endpoint.socket_path)
  end
end
```

## Setup and run

Use an empty directory on Linux with Ruby 3.3 or newer, Bundler, and tmux 3.3a
or newer installed.

Save this file beside the program using the displayed filename. It installs
`libtmux` 0.1.2 from RubyGems ([source](https://github.com/libtmux/libtmux-ruby/tree/46474e8a2f03e39fc2b0ff73b6a841777b79c4d2)).

```ruby title="Gemfile"
source "https://rubygems.org"

gem "libtmux", "0.1.2"
```

Install the gem and run the program:

```console
$ bundle config set --local path vendor/bundle &&
  bundle install &&
  bundle exec ruby connect.rb
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; it prints
`work` and leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/).
