---
supportedPorts: []
title: Testing with tmux
description: Test on a private tmux server and preserve errors during cleanup.
sidebar:
  label: Testing with tmux
  group: Guides
  order: 7
tableOfContents: true
---

Give each test its own tmux socket. Start it with a known configuration, assert
the state your program needs, and stop only the server the test owns. This keeps
a test run separate from your interactive sessions.

## Run an isolated test

This complete shell test creates a session and a window, checks their names,
and prints `tmux fixture passed` on success. It requires tmux 3.2a or newer and
a POSIX shell. Save it as `test-tmux.sh`.

```sh title="test-tmux.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-guide.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! tmux -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || status=$?
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

tmux -S "$socket" -f /dev/null new-session -d -s fixture -n main 'cat'
tmux -S "$socket" new-window -t fixture: -n worker 'cat'
name=$(tmux -S "$socket" display-message -p -t fixture:worker '#{session_name}')
if [ "$name" != fixture ]; then
    printf 'Expected fixture, got %s.\n' "$name" >&2
    exit 1
fi
windows=$(tmux -S "$socket" list-windows -t '=fixture' -F '#{window_name}')
if ! printf '%s\n' "$windows" | grep -Fqx worker; then
    printf '%s\n' 'The worker window was not created.' >&2
    exit 1
fi
printf '%s\n' 'tmux fixture passed'
```

Run the saved script:

```console
$ sh test-tmux.sh
```

The trap preserves a failed assertion's exit status and also reports cleanup
failures. If the server cannot be stopped, its socket directory stays available
for inspection. Each invocation gets a fresh directory from `mktemp`.

## Wait for the state you assert

A successful `send-keys` call establishes that tmux accepted input, not that the
application finished processing it. For output assertions, use a bounded wait
such as the [complete capture example](/examples/capture-pane-output/). A fixed
pause alone cannot establish that the result arrived.

<a id="java-docs-tests"></a>

## Use a language test fixture

Language ports have different fixture and lifetime APIs. Select a port from
the dropdown for its testing guidance. The complete programs below demonstrate
creating a private server, checking a result and cleaning up through that port:

[Python](/py/latest/examples/capture-pane-output/) ·
[TypeScript](/ts/latest/examples/capture-pane-output/) ·
[Go](/go/latest/examples/capture-pane-output/) ·
[Rust](/rs/latest/examples/capture-pane-output/) ·
[Java](/java/latest/examples/capture-pane-output/) ·
[Kotlin](/kotlin/latest/examples/capture-pane-output/) ·
[Scala](/scala/latest/examples/capture-pane-output/) ·
[.NET](/dotnet/latest/examples/capture-pane-output/) ·
[F#](/fsharp/latest/examples/capture-pane-output/) ·
[C++](/cxx/latest/examples/capture-pane-output/) ·
[Swift](/swift/latest/examples/capture-pane-output/) ·
[Ruby](/ruby/latest/examples/capture-pane-output/) ·
[Lua](/lua/latest/examples/capture-pane-output/)

## Where to go next

[Attaching to tmux](../attaching-to-tmux/) connects to a server that should remain
running. [Querying and filtering](../querying-and-filtering/) selects an exact
target, and [Capturing output](../capturing-output/) reads its screen.

## tmux reference

See [new-session](/tmux/latest/reference/new-session/),
[new-window](/tmux/latest/reference/new-window/), and
[kill-server](/tmux/latest/reference/kill-server/) for the commands used by the
fixture. The [global options](/tmux/latest/reference/manual/#DESCRIPTION)
describe socket selection and configuration files.

The [tmux manual](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
documents these commands and their flags.
