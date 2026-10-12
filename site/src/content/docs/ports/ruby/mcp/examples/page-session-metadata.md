---
title: Page session metadata from Ruby
description: Embed the Ruby MCP application, read a retained session listing, and close its owned resources.
port: ruby
product: mcp
sidebar:
  label: Page session metadata
  group: Examples
  order: 10
---

Use the MCP application directly when a Ruby host needs the same tool policy
and result envelopes as its MCP clients. This complete example creates two
sessions, selects one row per page, and prints both names from one retained
metadata capture.

It calls the application in process. For a client that launches a stdio
server, use the [client guide](../../guides/connect-client/).

## Prepare the project

Use Ruby 4.0.7 with its development headers, Bundler, Git, a C compiler and
Make, and tmux 3.2a or newer on a Unix host. The locked bundle includes native
extensions. Start with an empty directory:

```console
$ mkdir ruby-mcp-pages && cd ruby-mcp-pages
```

Fetch the source:

```console
$ git clone https://github.com/libtmux/libtmux-ruby libtmux-source
```

Select the documented revision:

```console
$ git -C libtmux-source checkout 9b1545562a112353c2c893a1d3e8c0d9b4b51f8d
```

Install the locked dependencies:

```console
$ BUNDLE_FROZEN=true BUNDLE_GEMFILE=./libtmux-source/Gemfile bundle install
```

## Run the complete example

Save this file beside the source checkout:

```ruby title="snapshot-sessions.rb"
# frozen_string_literal: true

ENV["BUNDLE_GEMFILE"] = File.expand_path("libtmux-source/Gemfile", __dir__)
require "bundler/setup"
require "libtmux/mcp"

def describe_failure(error)
  details = ["#{error.class}: #{error.message}"]
  if error.is_a?(LibTmux::Error)
    details.concat(error.cleanup_errors.map { |message| "Cleanup: #{message}" })
  end
  if error.respond_to?(:async_cleanup_errors)
    async_errors = error.async_cleanup_errors
    details.concat(async_errors.map { |message| "Cleanup: #{message}" })
  end
  details.join("\n")
end

def tool_data(application, name, arguments = {})
  result = application.call(name, arguments).structured_content
  return result.fetch("data") if result.fetch("ok")

  error = result.fetch("error")
  raise "#{name}: #{error.fetch('code')} (#{error.fetch('delivery')}): " \
    "#{error.fetch('message')}"
end

server = nil
failures = []
begin
  server = LibTmux::Server.start(timeout: 5.0)
  %w[build editor].each do |name|
    server.new_session(name: name, command: ["/bin/cat"], timeout: 5.0)
  end

  Async do |parent|
    LibTmux::Async.open(parent: parent, server: server) do |scope|
      application = nil
      begin
        application = LibTmux::MCP::Application.new(
          server: scope.server, endpoint_name: "example", request_timeout: 5.0
        )
        capabilities = tool_data(application, "tmux_capabilities")
        puts "Endpoint: #{capabilities.fetch('endpoint')}"

        page = tool_data(
          application, "tmux_snapshot", {entity: "session", limit: 1}
        )
        loop do
          page.fetch("items").each do |item|
            puts item.fetch("fields").fetch("name")
          end
          break unless page.fetch("truncated")

          page = tool_data(
            application, "tmux_snapshot", {cursor: page.fetch("next_cursor")}
          )
        end
      ensure
        begin
          application&.close
        rescue StandardError => error
          failures << "MCP cleanup failed: #{describe_failure(error)}"
        end
      end
    end
  end.wait
rescue StandardError => error
  failures << describe_failure(error)
ensure
  begin
    server&.close
  rescue StandardError => error
    failures << "Server cleanup failed: #{describe_failure(error)}"
  end
end
abort failures.join("\n") unless failures.empty?
```

Run it with tmux available on `PATH`:

```console
$ ruby -W:no-experimental snapshot-sessions.rb
```

Expected output:

```text
Endpoint: example
build
editor
```

The Ruby option suppresses the experimental [`IO::Buffer`](https://docs.ruby-lang.org/en/4.0/IO/Buffer.html) warning. It does not
suppress operation or cleanup errors. A failure produces a nonzero exit and
diagnostics on stderr; earlier stdout may contain partial results.

## Pagination

`Application` requires a `LibTmux::Async::Server` facade inside its owning
Async scheduler. `LibTmux::Async.open` supplies that facade and closes the
scope after the block. The application and its calls stay in the same
scheduler throughout the example.

The first `tmux_snapshot` call selects session metadata with a page limit of
one. A continuation sends only the returned `next_cursor`. It keeps the same
capture and selection; it does not relist sessions. The private daemon has
two sessions, so this example receives two pages. `truncated: false` ends the
loop.

Every call checks the application's `structured_content` envelope before
using `"data"`. Tool failures include a code, delivery state, and message. A
missing or expired cursor is an error to handle, not an instruction to
silently restart the listing. The [snapshot topic](../../topics/snapshots-and-references/)
explains cursor lifetime, capacity, and reference identity.

## Resource ownership

`Server.start` creates a private socket directory and foreground tmux daemon
with an empty configuration. The program creates its own `build` and `editor`
sessions running `cat`; no existing socket, session, or pane is required.

The MCP application uses its default capability and snapshot tools. The two
sessions are ordinary Ruby API setup, not mutations admitted through the MCP
tool policy. Embedding the application does not constrain what other Ruby
code in the host can do.

Startup and each session creation have separate five-second deadlines.
The application uses `request_timeout: 5.0` for metadata acquisition during
capability discovery and fresh snapshot calls. Continuations read retained
data. Shutdown first closes the application, then its Async scope, then the
owned daemon. Each cleanup attempt still runs if an earlier operation or
cleanup fails, and the program reports the collected errors.

The [pinned application implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-mcp/lib/libtmux/mcp/application.rb)
and [Async scope](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-async/lib/libtmux/async.rb)
define these ownership and request contracts.
