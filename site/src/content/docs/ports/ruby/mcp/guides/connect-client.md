---
title: Connect a Ruby MCP client
description: Launch a pinned Ruby MCP server on its own private tmux socket, inspect the default tools, and close it with the client.
port: ruby
product: mcp
sidebar:
  label: Connect a client
  group: Guides
  order: 10
---

Let your MCP client launch the Ruby server on a private tmux socket. The
launcher below creates one `mcp-example` session, offers capability discovery
and metadata snapshots, and stops its owned tmux daemon when the client closes
the connection.

## Prepare the project

Use Ruby 4.0.7 with its development headers, Bundler, Git, a C compiler and
Make, and tmux 3.2a or newer on a Unix host. The bundle includes native
extensions such as `io-event`, `json`, and `fiddle`. This recipe uses the
source revision whose MCP contract is documented here; it does not
assume that a newer checkout and an installed prerelease have identical APIs.

Create an empty directory:

```console
$ mkdir ruby-mcp-client && cd ruby-mcp-client
```

Fetch the source:

```console
$ git clone https://github.com/libtmux/libtmux-ruby libtmux-source
```

Select the documented revision:

```console
$ git -C libtmux-source checkout 9b1545562a112353c2c893a1d3e8c0d9b4b51f8d
```

Install the dependencies from its lockfile:

```console
$ BUNDLE_FROZEN=true BUNDLE_GEMFILE=./libtmux-source/Gemfile bundle install
```

This installs the source checkout's core and MCP gems together. Keep the
checkout beside the launcher so the client's working directory does not affect
which gems it loads.

## Save the launcher

Save this complete program as `run-mcp.rb` in the project directory:

```ruby title="run-mcp.rb"
# frozen_string_literal: true

ENV["BUNDLE_GEMFILE"] = File.expand_path("libtmux-source/Gemfile", __dir__)
require "bundler/setup"
require "libtmux/mcp/cli"

def describe_failure(error)
  details = ["#{error.class}: #{error.message}"]
  if error.is_a?(LibTmux::Error)
    details.concat(error.cleanup_errors.map { |message| "Cleanup: #{message}" })
  end
  details.join("\n")
end

server = nil
failures = []
begin
  server = LibTmux::Server.start(timeout: 5.0)
  server.new_session(name: "mcp-example", command: ["/bin/cat"], timeout: 5.0)
  status = LibTmux::MCP::CLI.run([
    "--socket", server.endpoint.socket_path,
    "--endpoint", "docs",
    "--timeout", "5"
  ])
  failures << "MCP stopped with status #{status}" unless status.zero?
rescue StandardError => error
  failures << describe_failure(error)
ensure
  begin
    server&.close
  rescue StandardError => error
    failures << "Cleanup failed: #{describe_failure(error)}"
  end
end
abort failures.join("\n") unless failures.empty?
```

`Server.start` owns a new socket directory and foreground daemon with an empty
tmux configuration. It starts no session by itself; `new_session` creates the
example's pane running `cat`. Closing this owned server stops its daemon.
The MCP command borrows that endpoint and closes its own clients when stdin
ends. The outer launcher then closes the daemon it created.

The five-second startup deadline, five-second session-creation deadline, and
five-second MCP request deadline govern separate operations. The server keeps
serving while the client remains connected. Diagnostics go to stderr; stdout
contains MCP messages only. Operation and cleanup failures are both reported.

Run it directly to check startup:

```console
$ ruby -W:no-experimental run-mcp.rb
```

It waits for a client. Send EOF to close it. The Ruby option suppresses the
runtime's experimental [`IO::Buffer`](https://docs.ruby-lang.org/en/4.0/IO/Buffer.html) warning; it does not suppress exceptions.

## Configure a client

For a client that accepts an `mcpServers` configuration, generate the entry
using this project's absolute launcher path and the current Ruby executable:

```console
$ ruby -rjson -rrbconfig -e '
  puts JSON.pretty_generate(
    "mcpServers" => {
      "tmux-ruby" => {
        "command" => RbConfig.ruby,
        "args" => ["-W:no-experimental", File.expand_path("run-mcp.rb")]
      }
    }
  )
'
```

Add that entry to the client's existing configuration and reconnect. Other
clients ask for a command and argument list separately; use the same values.
The client needs tmux available on its process `PATH`. If its environment
cannot find the intended executable, give the launcher an absolute `executable:`
argument in `Server.start` and pass that same path with the MCP CLI's `--tmux`
option.

## Verify the connection

List the tools. The default catalog contains exactly `tmux_capabilities` and
`tmux_snapshot`. Capture, wait, create, send, close, and authored-run tools are
absent until explicitly enabled.

Call `tmux_capabilities` with an empty argument object. Its successful
`structuredContent` has `ok: true`; `data.endpoint` is `docs`. That alias labels
discovery and resource URIs. The `--socket` argument selects the actual daemon.

Call `tmux_snapshot` with this argument object:

```json
{"entity": "session"}
```

The successful result has one item in [`structuredContent.data.items`](../../tools/tmux_snapshot/). Its
`fields.name` is `mcp-example`, and its `ref` includes the session identity and
server generation. Check `ok` before reading successful data; a JSON-RPC
response alone does not establish that the tool succeeded.

Close the MCP connection. The launcher exits, stops its private daemon, and
removes its owned socket directory. Reconnecting runs the launcher again and
creates a fresh session, so do not reuse references from the previous server.

## Connect to a server your application owns

When the application already owns a tmux daemon, use the installed
`libtmux-mcp` executable with one explicit `--socket PATH` or `--socket-name NAME`
selector. It borrows the daemon: EOF closes the MCP clients without stopping
that daemon. The application's lifecycle remains responsible for it.

[Tool reference](../../tools/) describes the argument and result schemas.
[Source-owned MCP guide](../../source-guide/) explains policy, observation and
shell enrollment. The pinned [CLI implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-mcp/lib/libtmux/mcp/cli.rb)
and [owned-server implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux/lib/libtmux/owned.rb)
define these lifecycle boundaries.
