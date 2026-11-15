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

Bind a second `Server` to a running tmux server and find its `work` session.
The program starts a private server to stand in for one you already run, prints
the session name and stops that server on exit. It reports an error if the
connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `connect.rb`. `LibTmux::Server.start` owns the
private server and stops it when its block exits, including after an error.
`Server.new(endpoint: owner.endpoint)` binds a second connection to the same
socket, as it would to a server you started elsewhere. Closing that binding
leaves the daemon running.

```ruby title="connect.rb"
require "libtmux"

LibTmux::Server.start do |owner|
  owner.new_session(name: "work", command: ["/bin/cat"])
  server = LibTmux::Server.new(endpoint: owner.endpoint)
  begin
    session = server.snapshot.sessions.find do |candidate|
      candidate.name == "work"
    end
    raise "The work session does not exist" unless session
    puts session.name
  ensure
    server.close
  end
end
```

To attach to a server of your own, drop the `Server.start` block and open its
socket with `LibTmux::Server.open(socket_path: "/path/to/socket")`.

## Setup and run

Use an empty directory on Linux with Git and tmux 3.3a or newer installed.

This example was checked with Ruby 4.0.7, Bundler.

Save this file beside the program using the displayed filename.

```ruby title="Gemfile"
source "https://rubygems.org"

gem "libtmux", path: "libtmux-source/gems/libtmux"
```

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-ruby libtmux-source &&
  git -C libtmux-source checkout 2599d45369515aaf2fd5793bfe71cdc20de641b6 &&
  bundle config set --local path vendor/bundle &&
  bundle install &&
  bundle exec ruby connect.rb
```

The program prints `work`. The server it started is gone when the program
exits.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a program that sends input and captures output, see
[Capture pane output](/examples/capture-pane-output/).
