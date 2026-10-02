---
port: go
route: concepts/queries
title: Filtering and queries
description: Filter captured Go tmux objects, handle missing and ambiguous results, and query related windows.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Read a snapshot once when several questions concern the same captured state.
[`tmuxq.Matching`](../../reference/tmuxq-matching/) applies typed filters in Go
without another tmux call. [`tmuxq.ExactlyOne`](../../reference/tmuxq-exactlyone/)
distinguishes an absent result from an ambiguous one. Neither reserves an
object for a later mutation.

[`SessionFilter`](../../reference/tmux-sessionfilter/) fields are ANDed.
`AnyOf` adds an OR condition; `Not` excludes a match. Names and regular
expressions are case sensitive unless the regular expression enables another
mode. A nil field leaves the criterion unset; a pointer to an empty string
still supplies a criterion. `tmux.Ptr` is useful for these pointer fields.

## Setup and run

Use an empty directory on Linux or macOS with Git, Go 1.26 or newer, and
tmux 3.2a or newer. Save these two files and any complete Go program below.
Each program includes its imports and entry point; run it by filename so
other examples in the directory do not introduce duplicate `main` functions.

```text title="go.mod"
module example.com/concepts

go 1.26.0

require github.com/libtmux/libtmux-go v0.0.0

replace github.com/libtmux/libtmux-go => ./libtmux-source
```

The launcher starts two sessions on a private socket: `work-one` with an
`editor` window and `work-two` with a `logs` window. Each pane runs `cat` to
keep it alive. Every run gets a fresh fixture. The launcher stops only that
server on success or failure, and retains its directory if shutdown fails.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d /tmp/libtmux-go-concepts.XXXXXX)
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket"
"$binary" -S "$socket" -f /dev/null new-session -d -s work-one -n editor /bin/cat
"$binary" -S "$socket" new-session -d -s work-two -n logs /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work-one'
```

Fetch the documented library revision and resolve this module's dependencies:

```console
$ git clone https://github.com/libtmux/libtmux-go libtmux-source &&
  git -C libtmux-source checkout bb06e26e116e941813ca40bf45e7e3a47d38f52a &&
  GOWORK=off go mod tidy
```

The programs use a five-second context for tmux operations. Errors reach
`main`, which reports the error and exits unsuccessfully. The launcher's
cleanup runs independently of that context. A cancelled mutation can already
have reached tmux; inspect the current state before retrying it.

<a id="go-rust-java-c-typed-fields-that-fail-queries-at-compile-time"></a>
<a id="typed-and-local-filters"></a>

## Match names and combine conditions

Use `NameRegex` for a prefix, then combine it with exclusion. `AnyOf` accepts
either exact name. These queries all reuse the same snapshot. The final check
shows an invalid regular expression is an `ErrInvalidFilter` error, rather
than an empty result.

```go title="Local.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
	"github.com/libtmux/libtmux-go/tmuxq"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	socket := os.Getenv("LIBTMUX_SOCKET_PATH")
	if socket == "" {
		return errors.New("run this program with run.sh")
	}
	server, err := tmux.NewServer(tmux.ServerOptions{SocketPath: socket, ConfigFile: "/dev/null"})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	snapshot, err := server.Snapshot(ctx)
	if err != nil {
		return err
	}
	cases := []struct {
		label  string
		filter tmux.SessionFilter
		want   string
	}{
		{"prefix", tmux.SessionFilter{NameRegex: "^work-"}, "work-one, work-two"},
		{"AND and NOT", tmux.SessionFilter{
			NameRegex: "^work-", Not: tmux.Ptr(tmux.SessionNameIs("work-two")),
		}, "work-one"},
		{"OR", tmux.SessionFilter{AnyOf: []tmux.SessionFilter{
			tmux.SessionNameIs("work-one"), tmux.SessionNameIs("work-two"),
		}}, "work-one, work-two"},
		{"case-sensitive", tmux.SessionFilter{NameRegex: "^WORK-"}, ""},
	}
	for _, test := range cases {
		matches, err := tmuxq.Matching(snapshot.Sessions(), test.filter)
		if err != nil {
			return fmt.Errorf("%s: %w", test.label, err)
		}
		names := make([]string, 0, len(matches))
		for _, session := range matches {
			name, ok := session.Name()
			if !ok {
				return errors.New("session name was not captured")
			}
			names = append(names, name)
		}
		slices.Sort(names)
		got := strings.Join(names, ", ")
		if got != test.want {
			return fmt.Errorf("%s: got %q, want %q", test.label, got, test.want)
		}
		if got == "" {
			got = "(no matches)"
		}
		fmt.Printf("%s: %s\n", test.label, got)
	}
	_, err = tmuxq.Matching(snapshot.Sessions(), tmux.SessionFilter{NameRegex: "["})
	if !errors.Is(err, tmux.ErrInvalidFilter) {
		return fmt.Errorf("expected invalid filter, got %v", err)
	}
	fmt.Println("invalid regular expression: rejected")
	return nil
}
```

```console
$ sh run.sh env GOWORK=off go run Local.go
```

Expected program output:

```text
prefix: work-one, work-two
AND and NOT: work-one
OR: work-one, work-two
case-sensitive: (no matches)
invalid regular expression: rejected
```

<a id="the-cardinality-contract-side-by-side"></a>
<a id="result-counts"></a>

## Distinguish missing and ambiguous results

Compile the typed filter, then use `ExactlyOne` when a later operation needs
one target. Check `ErrNoMatch` and `ErrMultipleMatches` with `errors.Is`, which
also works after wrapping the error with `%w`. Use `tmuxq.First` only when
choosing the first match is intentional; it cannot report ambiguity.

```go title="Cardinality.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
	"github.com/libtmux/libtmux-go/tmuxq"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	socket := os.Getenv("LIBTMUX_SOCKET_PATH")
	if socket == "" {
		return errors.New("run this program with run.sh")
	}
	server, err := tmux.NewServer(tmux.ServerOptions{SocketPath: socket, ConfigFile: "/dev/null"})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sessions, err := server.Sessions(ctx)
	if err != nil {
		return err
	}
	cases := []struct {
		label  string
		filter tmux.SessionFilter
		want   error
	}{
		{"work-one", tmux.SessionNameIs("work-one"), nil},
		{"missing", tmux.SessionNameIs("missing"), tmuxq.ErrNoMatch},
		{"work-", tmux.SessionFilter{NameRegex: "^work-"}, tmuxq.ErrMultipleMatches},
	}
	for _, test := range cases {
		predicate, err := test.filter.Predicate()
		if err != nil {
			return err
		}
		selected, err := tmuxq.ExactlyOne(sessions, predicate)
		if !errors.Is(err, test.want) {
			return fmt.Errorf("%s: unexpected result: %v", test.label, err)
		}
		switch {
		case err == nil:
			name, ok := selected.Name()
			if !ok || name != test.label {
				return errors.New("selected the wrong session")
			}
			fmt.Printf("%s: selected\n", name)
		case errors.Is(err, tmuxq.ErrNoMatch):
			fmt.Printf("%s: absent\n", test.label)
		case errors.Is(err, tmuxq.ErrMultipleMatches):
			fmt.Printf("%s: ambiguous\n", test.label)
		}
	}
	return nil
}
```

```console
$ sh run.sh env GOWORK=off go run Cardinality.go
```

Expected program output:

```text
work-one: selected
missing: absent
work-: ambiguous
```

## Filter related windows and compare a live listing

[`WindowRel`](../../reference/tmux-windowrel/) supports `Some`, `Every` and
`None`. For a captured empty relation, `Every` and `None` are true and `Some`
is false. An uncaptured relation matches none of those quantifiers. Check
`Session.Windows()` when missing relations should be an application error.

The program checks all three quantifiers against the captured hierarchy.
It then sends a [`TmuxFilter`](../../reference/tmux-tmuxfilter/) to
[`Server.SearchSessions`](../../reference/tmux-server-searchsessions/).
That expression runs inside tmux and returns only session records. It does
not capture their windows, so treating the result as a session with no
`editor` window would be incorrect.

```go title="Relations.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
	"github.com/libtmux/libtmux-go/tmuxq"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	socket := os.Getenv("LIBTMUX_SOCKET_PATH")
	if socket == "" {
		return errors.New("run this program with run.sh")
	}
	server, err := tmux.NewServer(tmux.ServerOptions{SocketPath: socket, ConfigFile: "/dev/null"})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	snapshot, err := server.Snapshot(ctx)
	if err != nil {
		return err
	}
	editor := tmux.WindowNameIs("editor")
	cases := []struct {
		label    string
		relation tmux.WindowRel
		want     string
	}{
		{"some editor", tmux.WindowRel{Some: &editor}, "work-one"},
		{"no editor", tmux.WindowRel{None: &editor}, "work-two"},
		{"every window is editor", tmux.WindowRel{Every: &editor}, "work-one"},
	}
	for _, test := range cases {
		matches, err := tmuxq.Matching(snapshot.Sessions(), tmux.SessionFilter{Windows: &test.relation})
		if err != nil {
			return err
		}
		if len(matches) != 1 {
			return fmt.Errorf("%s: expected one match, got %d", test.label, len(matches))
		}
		name, ok := matches[0].Name()
		if !ok || name != test.want {
			return fmt.Errorf("%s: unexpected session %q", test.label, name)
		}
		fmt.Printf("%s: %s\n", test.label, name)
	}

	filter := tmux.TmuxFilter("#{==:#{session_name},work-one}")
	live, err := server.SearchSessions(ctx, &filter)
	if err != nil {
		return err
	}
	if len(live) != 1 {
		return errors.New("live filter should return work-one")
	}
	if _, captured := live[0].Windows(); captured {
		return errors.New("a session-only listing should not contain window relations")
	}
	matches, err := tmuxq.Matching(live, tmux.SessionFilter{Windows: &tmux.WindowRel{None: &editor}})
	if err != nil {
		return err
	}
	if len(matches) != 0 {
		return errors.New("an uncaptured relation is not an empty relation")
	}
	fmt.Println("live session listing: window relations not captured")
	return nil
}
```

```console
$ sh run.sh env GOWORK=off go run Relations.go
```

Expected program output:

```text
some editor: work-one
no editor: work-two
every window is editor: work-one
live session listing: window relations not captured
```

## Choose local or tmux-side filtering

Typed `SessionFilter`, `WindowFilter`, `PaneFilter` and `ClientFilter` inspect
materialized Go records. A `TmuxFilter` is instead a tmux format expression
passed to a live listing. It is not a serialized Go predicate. Do not build
format expressions by interpolating arbitrary input; use a typed local
filter for application-provided values.

Use a new snapshot when repeating a decision must observe recent changes.
The [rename example](../server-session-window-pane/#walk-a-capture-and-observe-a-rename)
shows the old and new values together. A successful lookup does not guarantee
that the object still exists when a later command runs; check that command's
error even after the query succeeds.
