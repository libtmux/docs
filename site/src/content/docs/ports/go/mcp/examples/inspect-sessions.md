---
title: List sessions through MCP
description: Start a private tmux server and read its session metadata through a complete Go SDK client.
port: go
product: mcp
sidebar:
  group: Examples
  order: 10
---

This program creates a private tmux session, launches `libtmux-mcp` as a
child process with the `inspect` toolset, and calls
[`list_sessions`](../../tools/list_sessions/). It checks the returned session
ID against the session it created, then closes the client and stops its server.

## Run the example

Use Go 1.26 or newer and tmux 3.2a or newer on Linux, macOS, or WSL.
The project pins the [core library](https://github.com/libtmux/libtmux-go/tree/3f6f99dd41f077aaac2fa18acf7c82d99f58c7cd)
and [MCP executable](https://github.com/libtmux/libtmux-go/tree/6e7420927f4cb717fe089a710328e44e8d551025/mcp)
to their published releases. The client uses the official Go MCP SDK.

Create an empty directory:

```console
$ mkdir inspect-mcp-sessions
```

Enter it:

```console
$ cd inspect-mcp-sessions
```

Install the MCP executable inside the project:

```console
$ GOBIN="$PWD/.tools" go install \
    github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp@v0.0.1-alpha.12
```

Save the module file:

```go title="go.mod"
module example.com/session-inspector

go 1.26.0

require (
	github.com/libtmux/libtmux-go v0.0.1-alpha.9
	github.com/modelcontextprotocol/go-sdk v1.6.1
)

require (
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/segmentio/asm v1.1.3 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/oauth2 v0.35.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
)
```

### Client program

Save this as `main.go`:

```go title="main.go"
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (result error) {
	directory, err := os.MkdirTemp("", "libtmux-go-mcp-")
	if err != nil {
		return err
	}

	server, err := tmux.NewServer(tmux.ServerOptions{
		SocketPath: filepath.Join(directory, "tmux.sock"),
		ConfigFile: "/dev/null",
	})
	if err != nil {
		return errors.Join(err, os.RemoveAll(directory))
	}
	defer func() {
		background := context.Background()
		cleanup, cancel := context.WithTimeout(background, 5*time.Second)
		defer cancel()
		if err := server.Kill(cleanup); err != nil {
			result = errors.Join(result, fmt.Errorf(
				"stop tmux; resources retained at %s: %w", directory, err,
			))
			return
		}
		result = errors.Join(result, os.RemoveAll(directory))
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	created, err := server.NewSession(ctx, tmux.NewSessionRequest{
		Name:    "demo",
		Command: "sh",
	})
	if err != nil {
		return err
	}

	binary, err := filepath.Abs(".tools/libtmux-mcp")
	if err != nil {
		return err
	}
	command := exec.Command(binary,
		"-socket-path", server.SocketPath(), "-binary", server.Executable(),
	)
	command.Stderr = os.Stderr
	command.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"LANG=C.UTF-8",
		"TMPDIR=" + directory,
		"LIBTMUX_TOOLSETS=inspect",
	}
	client := sdk.NewClient(&sdk.Implementation{
		Name: "session-inspector", Version: "1.0.0",
	}, nil)
	connection, err := client.Connect(ctx, &sdk.CommandTransport{
		Command: command, TerminateDuration: 3 * time.Second,
	}, nil)
	if err != nil {
		return fmt.Errorf("connect MCP client: %w", err)
	}
	defer func() {
		if err := connection.Close(); err != nil {
			closeErr := fmt.Errorf("close MCP client: %w", err)
			result = errors.Join(result, closeErr)
		}
	}()

	reply, err := connection.CallTool(ctx, &sdk.CallToolParams{
		Name: "list_sessions", Arguments: map[string]any{},
	})
	if err != nil {
		return fmt.Errorf("call list_sessions: %w", err)
	}
	if reply.IsError {
		for _, content := range reply.Content {
			if text, ok := content.(*sdk.TextContent); ok {
				return fmt.Errorf("list_sessions: %s", text.Text)
			}
		}
		return errors.New("list_sessions failed without a text explanation")
	}

	data, err := json.Marshal(reply.StructuredContent)
	if err != nil {
		return err
	}
	var listed struct {
		Sessions []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Windows  int    `json:"windows"`
			Attached int    `json:"attached"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(data, &listed); err != nil {
		return fmt.Errorf("decode sessions: %w", err)
	}
	want := string(created.ID())
	if len(listed.Sessions) != 1 || listed.Sessions[0].ID != want {
		return fmt.Errorf("unexpected session listing: %s", data)
	}
	session := listed.Sessions[0]
	fmt.Printf("%s: %d window(s), %d attached client(s)\n",
		session.Name, session.Windows, session.Attached,
	)
	return nil
}
```

Resolve the module dependencies:

```console
$ go mod tidy
```

Run the program from the directory containing both files and `.tools`:

```console
$ go run .
```

Its stdout is:

```text
demo: 1 window(s), 0 attached client(s)
```

## Read the result

[`tmux.NewServer`](../../../reference/tmux-newserver/) configures the private endpoint, and [`Server.NewSession`](../../../reference/tmux-server-newsession/)
starts the daemon with an empty tmux configuration. The MCP child connects to
that exact socket using the same tmux executable.

The SDK's [`CallTool`](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#ClientSession.CallTool) can return a protocol error before there is a tool result.
A returned reply can also set [`IsError`](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#CallToolResult); the program checks both before reading
[`StructuredContent`](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#CallToolResult). For this tool, structured content contains a `sessions`
array with `id`, `name`, `windows`, and `attached` fields.

The example decodes only the fields it needs and verifies that exactly one
session is returned with the expected ID. It does not assume that the first
item belongs to it. See the [tool reference](../../tools/list_sessions/) for
all returned fields and the [session-list handler](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/orientation_tools.go)
for the selected release's implementation.

## Shutdown

Startup and requests share a 20-second context. During shutdown, the client
closes the child's stdin, then escalates to SIGTERM and SIGKILL if needed. It
waits up to three seconds after each step. Deferred cleanup closes the client
before stopping the owned tmux server with a fresh five-second context, so an
expired request context does not skip daemon cleanup.

The child receives a curated environment with the selected socket and tmux
binary. Its temporary files live under the program's owned directory through
`TMPDIR`. It does not inherit `TMUX`, `TMUX_PANE`, or unrelated `LIBTMUX_*`
settings from your interactive shell.

The program joins operation and cleanup errors. It removes its temporary
directory only after [`Server.Kill`](../../../reference/tmux-server-kill/) succeeds; otherwise, it prints the retained
directory for inspection. Its [server cleanup implementation](https://github.com/libtmux/libtmux-go/blob/3f6f99dd41f077aaac2fa18acf7c82d99f58c7cd/tmux/lifecycle_kill.go)
defines the library's kill behavior.

The [connection guide](../../guides/connect-client/) covers connecting to an
existing server instead. The example's cleanup is appropriate because it
creates its own private socket and session.
