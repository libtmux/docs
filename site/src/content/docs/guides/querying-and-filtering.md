---
supportedPorts: []
title: Querying and filtering
description: Find an exact tmux session and select one pane using formats and filters.
sidebar:
  label: Querying and filtering
  group: Guides
  order: 6
tableOfContents: true
---

Use an exact target when you know its name, or filter a listing when you need to
inspect several objects. A session named `work` and one named `worker` should
not become interchangeable targets.

<a id="filling-in-the-rest-of-the-cardinality-table"></a>

## Require exactly one match

Prefix a session target with `=` to require an exact name. `has-session` reports
whether it exists; it does not return a pane. This script selects panes in
`work` and rejects both zero matches and multiple matches before using an ID.

Save the complete script as `query.sh`. It requires tmux 3.2a or newer and a
POSIX shell. It creates and cleans up its own server.

```sh title="query.sh"
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

tmux -S "$socket" -f /dev/null new-session -d -s work 'cat'
tmux -S "$socket" new-session -d -s worker 'cat'
tmux -S "$socket" has-session -t '=work'

panes=$(tmux -S "$socket" list-panes -a \
    -f '#{==:#{session_name},work}' -F '#{pane_id}')
# Pane IDs contain no whitespace; split the rows to count matches.
# shellcheck disable=SC2086
set -- $panes
if [ "$#" -ne 1 ]; then
    printf 'Expected one work pane, found %s.\n' "$#" >&2
    exit 1
fi
tmux -S "$socket" display-message -p -t "$1" '#{session_name}'
```

Run the saved script:

```console
$ sh query.sh
```

The output is `work`. The `worker` session remains outside the result. Targeting
the returned pane ID avoids repeating name matching when the next command runs.
An object can still disappear between commands; keep errors visible.

<a id="declarative-filters-that-travel-beyond-python-and-typescript"></a>

## Declarative filters

`list-panes -a` searches every session. `-f` evaluates a tmux format as a boolean
for each pane; here `#{==:#{session_name},work}` keeps only exact session-name
matches. `-F` chooses what each returned row contains. Using only `#{pane_id}`
keeps the result easy to pass to another tmux command.

## Case-insensitive matching

Choose case handling explicitly when a name may vary in capitalization. tmux's
`m` format operator supports an `i` modifier for case-insensitive matching.
Keep the ordinary `==` comparison when exact case is part of your contract.
[Filtering and queries](/concepts/queries/) explains the query model.

## Push the filter into tmux, or read once and filter locally

A tmux-side filter reduces returned rows. Capturing a listing once and filtering
it in your program is useful when several decisions should use the same read.
Neither approach reserves the objects. Unknown format names expand to empty
values; check an unexpectedly empty result before assuming nothing exists.

<a id="where-to-go-next"></a>

## Use a language library

The port dropdown opens the language's query guide. These complete programs
connect to an existing server, find exactly the `work` session and report its
absence:

[Python](/py/latest/guides/attaching-to-tmux/) ·
[TypeScript](/ts/latest/guides/attaching-to-tmux/) ·
[Go](/go/latest/guides/attaching-to-tmux/) ·
[Rust](/rs/latest/guides/attaching-to-tmux/) ·
[Java](/java/latest/guides/attaching-to-tmux/) ·
[Kotlin](/kotlin/latest/guides/attaching-to-tmux/) ·
[Scala](/scala/latest/guides/attaching-to-tmux/) ·
[.NET](/dotnet/latest/guides/attaching-to-tmux/) ·
[F#](/fsharp/latest/guides/attaching-to-tmux/) ·
[C++](/cxx/latest/guides/attaching-to-tmux/) ·
[Swift](/swift/latest/guides/attaching-to-tmux/) ·
[Ruby](/ruby/latest/guides/attaching-to-tmux/) ·
[Lua](/lua/latest/guides/attaching-to-tmux/)

## tmux reference

See [has-session](/tmux/latest/reference/has-session/),
[list-panes](/tmux/latest/reference/list-panes/), and the
[target syntax](/tmux/latest/reference/manual/#COMMANDS). The version selector
shows the flags supported by your installed tmux release.

The [tmux manual](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
documents these commands and their flags.
