---
port: go
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: Create Go tmux objects, list the hierarchy, and distinguish captured relations from fresh reads.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

A [`Server`](../../reference/tmux-server/) addresses a tmux server through its
socket. Its sessions hold window placements, and its windows hold panes.
[`NewServer`](../../reference/tmux-newserver/) validates configuration without
starting tmux. Creating a session starts tmux when the selected socket has no
server. The zero Go `Server` value is invalid.

Use [`Server.Snapshot`](../../reference/tmux-server-snapshot/) to capture the
hierarchy once, then traverse it locally. A snapshot performs sequential tmux
listings, so it is an observation rather than an atomic transaction. Its
records do not change when another command renames or removes an object.

## Setup and run

Use an empty directory on Linux or macOS with Go 1.26 or newer and
tmux 3.3a or newer. Save the module file and any complete Go program below. Each
program includes its imports and entry point; run it by filename so other
examples in the directory do not introduce duplicate `main` functions.

```gomod title="go.mod"
module example.com/concepts

go 1.26.0

require github.com/libtmux/libtmux-go v0.1.3
```

Each program starts its own tmux server on a socket in a new temporary
directory and creates two sessions: `work-one` with an `editor` window and
`work-two` with a `logs` window. Each pane runs `cat` to keep it alive. When the
program ends, `withServer` stops only that server and removes the directory,
including after an error. If tmux does not stop, the error names the directory
the program kept.

Resolve this module's dependencies. The module file requires `libtmux-go`
v0.1.3 from the Go module proxy ([source](https://github.com/libtmux/libtmux-go/tree/7ad2bfb0f74c02d395fec1962d5bb9556e2200cd)):

```console
$ go mod tidy
```

The programs use a five-second context for tmux operations. Errors reach
`main`, which reports the error and exits unsuccessfully. Cleanup runs
independently of that context. A cancelled mutation can already have reached
tmux; inspect the current state before retrying it.

## Create and list sessions, windows and panes

[`Server.NewSession`](../../reference/tmux-server-newsession/) creates a detached
`tools` session. [`Session.NewWindow`](../../reference/tmux-session-newwindow/)
adds `logs` beside its initial `editor` window, and
[`Window.SplitPane`](../../reference/tmux-window-splitpane/) adds a second pane
below the first. The 100-by-30 terminal leaves enough space for the split.
`cat` keeps these demonstration panes alive without shell configuration.

The program checks the complete server through
[`Server.Sessions`](../../reference/tmux-server-sessions/),
[`Server.Windows`](../../reference/tmux-server-windows/) and
[`Server.Panes`](../../reference/tmux-server-panes/). Each call reads fresh
state. When several collections should come from the same observation, use
one snapshot and its local accessors instead.

A creation result does not promise captured children: check the boolean from
`Session.Windows()`. The program captures again and uses the stable session
ID to find the created session and verify its descendants.

```go title="Create.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
)

const limit = 5 * time.Second

func main() {
	if err := withServer(demonstrate); err != nil {
		log.Fatal(err)
	}
}

func demonstrate(ctx context.Context, server tmux.Server) error {
	session, err := server.NewSession(ctx, tmux.NewSessionRequest{
		Name: "tools", WindowName: "editor", Command: "/bin/cat", Width: 100, Height: 30,
	})
	if err != nil {
		return fmt.Errorf("create tools session: %w", err)
	}
	if _, captured := session.Windows(); captured {
		return errors.New("a newly created session unexpectedly includes window relations")
	}
	window, err := session.NewWindow(ctx, tmux.NewWindowRequest{
		Name: tmux.Ptr("logs"), Command: "/bin/cat",
	})
	if err != nil {
		return fmt.Errorf("create logs window: %w", err)
	}
	if _, err := window.SplitPane(ctx, tmux.SplitPaneRequest{Command: "/bin/cat"}); err != nil {
		return fmt.Errorf("split logs window: %w", err)
	}

	sessions, err := server.Sessions(ctx)
	if err != nil {
		return err
	}
	windows, err := server.Windows(ctx)
	if err != nil {
		return err
	}
	panes, err := server.Panes(ctx)
	if err != nil {
		return err
	}
	if len(sessions) != 3 || len(windows) != 4 || len(panes) != 5 {
		return fmt.Errorf("unexpected counts: %d sessions, %d windows, %d panes",
			len(sessions), len(windows), len(panes))
	}
	fmt.Println("server: 3 sessions, 4 windows, 5 panes")

	snapshot, err := server.Snapshot(ctx)
	if err != nil {
		return err
	}
	captured, err := snapshot.SessionByID(session.ID())
	if err != nil {
		return err
	}
	children, ok := captured.Windows()
	if !ok || len(children) != 2 {
		return errors.New("tools should have 2 captured windows")
	}
	descendants, ok := captured.Panes()
	if !ok || len(descendants) != 3 {
		return errors.New("tools should have 3 captured panes")
	}
	fmt.Println("tools: 2 windows, 3 panes")
	return nil
}

func withServer(demo func(context.Context, tmux.Server) error) (err error) {
	dir, err := os.MkdirTemp("", "libtmux-concepts-")
	if err != nil {
		return err
	}
	server, err := tmux.NewServer(tmux.ServerOptions{
		SocketPath: filepath.Join(dir, "tmux.sock"),
		ConfigFile: "/dev/null",
	})
	if err != nil {
		return errors.Join(err, os.RemoveAll(dir))
	}
	stop := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), limit)
		defer cancel()
		if err := server.Kill(ctx); err != nil {
			return fmt.Errorf(
				"cannot stop tmux; kept %s: %w", dir, err,
			)
		}
		return os.RemoveAll(dir)
	}
	defer func() { err = errors.Join(err, stop()) }()
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	fixture := [][2]string{{"work-one", "editor"}, {"work-two", "logs"}}
	for _, names := range fixture {
		_, err := server.NewSession(ctx, tmux.NewSessionRequest{
			Name: names[0], WindowName: names[1], Command: "cat",
		})
		if err != nil {
			return err
		}
	}
	return demo(ctx, server)
}
```

```console
$ go run Create.go
```

Expected program output:

```text
server: 3 sessions, 4 windows, 5 panes
tools: 2 windows, 3 panes
```

<a id="stable-identity-not-name-or-index"></a>
<a id="snapshots-and-live-commands"></a>

## Walk a capture and observe a rename

The two fixture sessions each hold one window and one pane.
[`Session.Windows`](../../reference/tmux-session-windows/) and
[`Window.Panes`](../../reference/tmux-window-panes/) read the captured
relations without issuing another tmux command. Their boolean distinguishes
an available empty relation from one that was never captured.

Renaming `editor` returns a new record. The original window still says
`editor`; a new snapshot sees `renamed`. Retain IDs across reads rather than
using mutable names as identity.

```go title="Snapshot.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
)

const limit = 5 * time.Second

func main() {
	if err := withServer(demonstrate); err != nil {
		log.Fatal(err)
	}
}

func demonstrate(ctx context.Context, server tmux.Server) error {
	before, err := server.Snapshot(ctx)
	if err != nil {
		return err
	}
	if len(before.Sessions()) != 2 || len(before.Windows()) != 2 || len(before.Panes()) != 2 {
		return errors.New("expected the initial two-session fixture")
	}
	var editor tmux.Window
	found := false
	for _, session := range before.Sessions() {
		name, ok := session.Name()
		if !ok {
			return errors.New("session name was not captured")
		}
		windows, ok := session.Windows()
		if !ok || len(windows) != 1 {
			return errors.New("expected one captured window")
		}
		window := windows[0]
		windowName, ok := window.Name()
		if !ok {
			return errors.New("window name was not captured")
		}
		panes, ok := window.Panes()
		if !ok || len(panes) != 1 {
			return errors.New("expected one captured pane")
		}
		fmt.Printf("%s: %s, %d pane\n", name, windowName, len(panes))
		if name == "work-one" {
			editor, found = window, true
		}
	}
	if !found {
		return errors.New("work-one is missing")
	}
	renamed, err := editor.Rename(ctx, "renamed")
	if err != nil {
		return err
	}
	oldName, oldOK := editor.Name()
	newName, newOK := renamed.Name()
	if !oldOK || !newOK || oldName != "editor" || newName != "renamed" {
		return errors.New("rename should return a new record without changing the old one")
	}
	after, err := server.Snapshot(ctx)
	if err != nil {
		return err
	}
	current, err := after.WindowByID(editor.ID())
	if err != nil {
		return err
	}
	currentName, ok := current.Name()
	if !ok || currentName != "renamed" {
		return errors.New("fresh snapshot missed the rename")
	}
	fmt.Printf("captured: %s; returned: %s; fresh: %s\n", oldName, newName, currentName)
	return nil
}

func withServer(demo func(context.Context, tmux.Server) error) (err error) {
	dir, err := os.MkdirTemp("", "libtmux-concepts-")
	if err != nil {
		return err
	}
	server, err := tmux.NewServer(tmux.ServerOptions{
		SocketPath: filepath.Join(dir, "tmux.sock"),
		ConfigFile: "/dev/null",
	})
	if err != nil {
		return errors.Join(err, os.RemoveAll(dir))
	}
	stop := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), limit)
		defer cancel()
		if err := server.Kill(ctx); err != nil {
			return fmt.Errorf(
				"cannot stop tmux; kept %s: %w", dir, err,
			)
		}
		return os.RemoveAll(dir)
	}
	defer func() { err = errors.Join(err, stop()) }()
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	fixture := [][2]string{{"work-one", "editor"}, {"work-two", "logs"}}
	for _, names := range fixture {
		_, err := server.NewSession(ctx, tmux.NewSessionRequest{
			Name: names[0], WindowName: names[1], Command: "cat",
		})
		if err != nil {
			return err
		}
	}
	return demo(ctx, server)
}
```

```console
$ go run Snapshot.go
```

Expected program output:

```text
work-one: editor, 1 pane
work-two: logs, 1 pane
captured: editor; returned: renamed; fresh: renamed
```

<a id="client-a-view-not-a-child"></a>

## Window placements and attached clients

A window linked into several sessions appears once per placement in
`Snapshot.Windows()`. Pane views also repeat for each placement. These
collection lengths count views, not necessarily distinct window or pane IDs.
`Snapshot.WindowByID` reports `ErrSnapshotAmbiguous` if an ID has several
views; `Snapshot.WindowsByID` returns all of them.

A client is an attached terminal view, not a child pane. `Snapshot.Clients()`
returns the captured clients. The subprocess calls here do not attach a
client. An application that opens a control connection owns that connection's
cleanup; stopping a tmux server is a separate action.

[Filtering and queries](../queries/) covers result counts and related-object
filters. [Sending keys](../../guides/sending-keys/) and the
[complete capture program](../../examples/capture-pane-output/) cover input
and waiting for output. Each program owns its demonstration server and stops
it; code connecting to a user's server should leave it running.
