---
title: Run a command through MCP
description: Use a complete Go SDK client to check command completion, exit status, and captured output.
port: go
product: mcp
sidebar:
  group: Examples
  order: 11
---

This program creates a private session, selects its active pane, and exposes
only [`run_shell_command`](../../tools/run_shell_command/) to the MCP client.
The shell command prints one line and deliberately exits with status 7.
The client checks completion and output before reporting the result.

## Run the example

Use Go 1.26 or newer and tmux 3.2a or newer on Linux, macOS, or WSL.
The project pins the [core library](https://github.com/libtmux/libtmux-go/tree/3f6f99dd41f077aaac2fa18acf7c82d99f58c7cd)
and [MCP executable](https://github.com/libtmux/libtmux-go/tree/6e7420927f4cb717fe089a710328e44e8d551025/mcp)
to their published releases. The client uses the official Go MCP SDK.

Create an empty directory:

```console
$ mkdir run-mcp-command
```

Enter it:

```console
$ cd run-mcp-command
```

Install the MCP executable inside the project:

```console
$ GOBIN="$PWD/.tools" go install \
    github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp@v0.0.1-alpha.12
```

Save the module file:

```go title="go.mod"
module example.com/command-runner

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
	directory, err := os.MkdirTemp("", "libtmux-go-command-")
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
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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

	pane, err := created.ResolveActivePane(ctx)
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
		"LIBTMUX_TOOLSETS=",
		"LIBTMUX_TOOLS=run_shell_command",
	}
	client := sdk.NewClient(&sdk.Implementation{
		Name: "command-runner", Version: "1.0.0",
	}, nil)
	connection, err := client.Connect(ctx, &sdk.CommandTransport{
		Command: command, TerminateDuration: 3 * time.Second,
	}, nil)
	if err != nil {
		return fmt.Errorf("connect MCP client: %w", err)
	}
	defer func() {
		if err := connection.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("close MCP client: %w", err))
		}
	}()

	reply, err := connection.CallTool(ctx, &sdk.CallToolParams{
		Name: "run_shell_command", Arguments: map[string]any{
			"pane_id":   string(pane.ID()),
			"command":   "printf 'command finished\\n'; (exit 7)",
			"timeout":   5,
			"max_lines": 20,
		},
	})
	if err != nil {
		return fmt.Errorf("call run_shell_command: %w", err)
	}
	if reply.IsError {
		for _, content := range reply.Content {
			if text, ok := content.(*sdk.TextContent); ok {
				return fmt.Errorf("run_shell_command: %s", text.Text)
			}
		}
		return errors.New("run_shell_command failed without a text explanation")
	}

	data, err := json.Marshal(reply.StructuredContent)
	if err != nil {
		return err
	}
	var ran struct {
		PaneID            string   `json:"pane_id"`
		ResolvedPaneIDs   []string `json:"resolved_pane_ids"`
		ExitStatus        *int     `json:"exit_status"`
		TimedOut          bool     `json:"timed_out"`
		Output            []string `json:"output"`
		OutputUnavailable string   `json:"output_unavailable"`
		LinesMissed       bool     `json:"lines_missed"`
	}
	if err := json.Unmarshal(data, &ran); err != nil {
		return fmt.Errorf("decode command result: %w", err)
	}
	if ran.TimedOut || ran.ExitStatus == nil {
		return errors.New("command completion is unconfirmed; do not retry it automatically")
	}
	if ran.PaneID != string(pane.ID()) || len(ran.ResolvedPaneIDs) != 1 || ran.ResolvedPaneIDs[0] != ran.PaneID {
		return fmt.Errorf("unexpected pane selection: %s", data)
	}
	if ran.OutputUnavailable != "" || ran.LinesMissed {
		return fmt.Errorf("command exited %d, but its output is incomplete: %s", *ran.ExitStatus, data)
	}
	fmt.Printf("exit status: %d\n", *ran.ExitStatus)
	for _, line := range ran.Output {
		fmt.Println(line)
	}
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
exit status: 7
command finished
```

## Check completion and output

[`Session.ResolveActivePane`](../../../reference/tmux-session-resolveactivepane/) supplies the pane ID. The request uses the public
wire fields `pane_id`, `command`, `timeout`, and `max_lines`; the client checks
that the reply names the same pane exactly once.

A nonzero shell exit status is distinct from a tool error. The request here
succeeds, completion is observed, and the shell's status is 7. A missing exit
status or `timed_out` means completion is unconfirmed. The program reports an
error instead of automatically sending the command again.

It also rejects `output_unavailable` and `lines_missed`. A command can finish
successfully while its terminal output is incomplete. The request retains at
most the newest 20 lines. The public reply does not report whether that cap
discarded earlier lines. Applications that retain partial output should display
its bounds and limitations alongside it. See
[Waits and output](../../topics/waits-and-output/) for timeout behavior and
other observation tools.

The [public command handler](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/capability_handlers.go)
validates the request and constructs the snake_case reply. The client decodes
that reply rather than depending on an internal Go result type.

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
