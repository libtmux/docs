---
port: ruby
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Ruby program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Ruby program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux 3.3a or newer and a Unix environment; no existing session is
required.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```ruby title="capture.rb"
require "libtmux"

LibTmux::Server.start do |server|
  created = server.new_session(
    name: "capture", command: ["/bin/sh"],
    environment: {"ENV" => "/dev/null"}, receipt: true
  )
  pane = created.pane
  pane.send_text("printf '\\nlibtmux capture ready\\n'")
  pane.send_keys("Enter")

  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 5
  loop do
    if pane.capture.stdout.lines(chomp: true).include?("libtmux capture ready")
      puts "libtmux capture ready"
      break
    end
    if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
      raise "Output did not arrive within five seconds"
    end
    sleep 0.025
  end
end
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

`LibTmux::Server.start` owns the private server. Leaving its block stops the server, including when capture or the deadline raises an error.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the files using the displayed names. You need
Ruby 3.3 or newer and Bundler. Bundler installs `libtmux` 0.1.2 from RubyGems
with its runtime dependencies.

Save this dependency file beside the program.

```ruby title="Gemfile"
source "https://rubygems.org"

gem "libtmux", "0.1.2"
```

Install the gem into the project and run the program:

```console
$ bundle config set --local path vendor/bundle &&
  bundle install &&
  bundle exec ruby capture.rb
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `libtmux` 0.1.2 from RubyGems. Its [source](https://github.com/libtmux/libtmux-ruby/tree/46474e8a2f03e39fc2b0ff73b6a841777b79c4d2)
is on GitHub.
