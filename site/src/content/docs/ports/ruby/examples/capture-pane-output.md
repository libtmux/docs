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
You need tmux and a Unix environment; no existing session is required.

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
Ruby 4.0.7 and Bundler. Bundler installs the library and its runtime dependencies.

Save this dependency file beside the program.

```ruby title="Gemfile"
source "https://rubygems.org"

gem "libtmux", path: "libtmux-source/gems/libtmux"
```

The commands pin the library revision used to run this program.

```console
$ git clone https://github.com/libtmux/libtmux-ruby libtmux-source &&
  git -C libtmux-source checkout 2599d45369515aaf2fd5793bfe71cdc20de641b6 &&
  bundle config set --local path vendor/bundle &&
  bundle install &&
  bundle exec ruby capture.rb
```

<a id="source-inclusion"></a>

## Where this comes from

The displayed files were compiled or loaded with their native tools and run
on Linux with tmux 3.2a and 3.7c. The rendering checks preserve those file bytes.
