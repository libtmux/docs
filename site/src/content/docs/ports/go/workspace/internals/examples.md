---
title: Go workspace builder examples
description: Build and inspect a workspace from YAML on a private tmux server with Go.
port: go
product: workspace
aliases: [examples/workspace-from-file]
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Read a workspace file, create two windows and three panes, then stop the
private tmux server. The `/bin/cat` commands keep panes open without another
application or log file.

## Prepare the project

Use Go 1.26, Git, and tmux 3.2a or newer on Unix. Create an empty project and
fetch the source revision used by this example:

```console
$ mkdir go-workspace-example && cd go-workspace-example
```

```console
$ git init libtmux-source && \
    git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-go.git && \
    git -C libtmux-source fetch --depth=1 origin bb06e26e116e941813ca40bf45e7e3a47d38f52a && \
    git -C libtmux-source checkout --detach FETCH_HEAD
```

Create the module file. Both replacements select that checkout, so the core
and workspace libraries use the same source revision:

```go title="go.mod"
module example.com/workspace

go 1.26.0

require (
	github.com/libtmux/libtmux-go v0.0.1-alpha.9
	github.com/libtmux/libtmux-go/workspace v0.0.0
)

require go.yaml.in/yaml/v3 v3.0.5 // indirect

replace github.com/libtmux/libtmux-go => ./libtmux-source

replace github.com/libtmux/libtmux-go/workspace => ./libtmux-source/workspace
```

Create the workspace file in the same directory:

```yaml title="workspace.yaml"
session_name: workspace-example
windows:
  - window_name: editor
    layout: even-horizontal
    panes: [/bin/cat, /bin/cat]
  - window_name: logs
    panes: [/bin/cat]
```

## Build a session

Create the complete program below. It reads and validates the YAML before
creating a private socket directory. `Parse` rejects unknown configuration
fields; a misspelled key fails before the example starts tmux.

```go title="main.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
	"github.com/libtmux/libtmux-go/workspace"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (err error) {
	document, err := os.ReadFile("workspace.yaml")
	if err != nil {
		return err
	}
	described, err := workspace.Parse(document)
	if err != nil {
		return err
	}
	directory, err := os.MkdirTemp("/tmp", "libtmux-go-workspace-")
	if err != nil {
		return err
	}
	config := filepath.Join(directory, "tmux.conf")
	if err = os.WriteFile(config, []byte("set -g default-shell /bin/sh\n"+
		"set-environment -g ENV /dev/null\n"+
		"set-environment -g BASH_ENV /dev/null\n"), 0600); err != nil {
		return errors.Join(err, os.RemoveAll(directory))
	}
	socket := filepath.Join(directory, "s")
	server, err := tmux.NewServer(tmux.ServerOptions{
		SocketPath: socket,
		ConfigFile: config,
	})
	if err != nil {
		return errors.Join(err, os.RemoveAll(directory))
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if cleanupErr := server.Kill(cleanup); cleanupErr != nil {
			err = errors.Join(err, fmt.Errorf("stop private server at %s: %w", socket, cleanupErr))
			return
		}
		err = errors.Join(err, os.RemoveAll(directory))
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := workspace.Build(ctx, server, described)
	if err != nil {
		return fmt.Errorf("build workspace: %w", err)
	}
	windows, err := session.SearchWindows(ctx, nil)
	if err != nil {
		return err
	}
	panes, err := server.Panes(ctx)
	if err != nil {
		return err
	}
	if len(windows) != 2 || len(panes) != 3 {
		return fmt.Errorf("expected two windows and three panes, got %d and %d", len(windows), len(panes))
	}
	fmt.Printf("built: %d windows\npanes: %d\n", len(windows), len(panes))
	return nil
}
```

`Build` opens a control connection for construction, closes it, and returns a
session handle that can be used for later operations. Pane commands may still
be running when the build returns. Check the application itself for readiness.

For an application that already owns a connection, use
`Workspace.InitialSessionRequest` to create the initial session, then pass it
to `BuildInto`. That function populates the supplied session and leaves
connection ownership with the caller.

## Verification

Resolve dependencies and run the program from the project directory:

```console
$ go mod tidy
```

```console
$ go run .
```

Expected output:

```text
built: 2 windows
panes: 3
```

A failed build can leave part of the workspace in tmux. Cleanup is registered
before `Build` and uses its own five-second deadline, so an expired build
context does not skip server shutdown. If stopping tmux fails, the program
keeps the socket directory and reports the cleanup error alongside any build
error.

For a workspace that stays open, let your application retain its explicitly
selected server and choose when to stop it.

<a id="where-this-comes-from"></a>
<a id="source-inclusion"></a>

[Builder source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/builder.go);
[configuration source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/workspace.go).
