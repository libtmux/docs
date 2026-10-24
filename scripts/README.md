# Build scripts

How to assemble a complete local copy of libtmux.org, and how the version
manifest it serves is produced.

## Prerequisites

Use the Node and pnpm versions declared in `package.json`. Integrated guide
staging also needs the source checkouts named in `site/src/lib/ports.ts` at
its recorded revisions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup
and verification loops.

A full local assembly can run native reference generators when their
runtime and checkout are present. Missing optional generators produce
`skipped` rows. Selected-source MCP export is required even with
`--skip-refs`; a failed exporter fails that build.

## Full local build

```console
$ pnpm build:site
```

The default output is `_site/`. Each locale has its own tree, such as
`_site/en/`, containing shared prose and a version subtree for each selected
port. Rust, Go and Java have local guides and references as well as links to
their ecosystem documentation hosts.

`LIBTMUX_DOCS_OUT_DIR` changes the assembly directory. The build replaces
that directory, so select a dedicated generated-output location. The
assembly lock covers the checkout because Astro staging is shared across
builds, including builds with different output directories.

Shell builds use a content-addressed `.build-cache/`. `--no-cache` rebuilds
the shells; `LIBTMUX_DOCS_CACHE` selects a separate cache directory. Native
reference output is cached with its source revision and logs. Cache entries
older than fourteen days are removed during an assembly.

### Reference generator statuses

The final table reports each port and version's reference result:

- `built`: a native reference was generated and assembled.
- `redirected`: the legacy `api/` entry points at the shell's `reference/`.
- `skipped`: the native generator or its input is unavailable, or the run
  selected `--skip-refs`. This does not establish reference coverage.
- `failed`: the generator failed; inspect the named `.build-logs/` file.
- `not listed`: the selected version is absent from the port manifest.

A shell compilation failure aborts the assembly. Check the summary and run
checks against the assembled output before publishing it.

### Clean generated builds

Stop development and preview servers, then list generated output:

```console
$ pnpm run clean --dry-run --cache
```

Remove the listed output and reusable build cache:

```console
$ pnpm run clean --cache
```

Cleanup removes `_site/`, `_site.*/`, `site/dist/`, `site/.astro/` and
transient API and guide staging. Without `--cache`, `.build-cache/` stays.
The assembly lock prevents cleaning a running assembly. Source,
`node_modules/` and `output/` review evidence stay intact. Custom output
and cache directories require explicit cleanup at their own locations.

### Options

```console
$ ./scripts/build-site.sh --ports py,ts --versions latest
```

```console
$ ./scripts/build-site.sh --skip-refs
```

```console
$ ./scripts/build-site.sh --skip-pagefind
```

`--ports` limits which ports get a shell build and a reference
generation pass (comma-separated slugs from `site/src/lib/ports.ts`).
`--versions` overrides the default `latest,stable`. `--skip-refs` builds
only the shell and search index. `--skip-pagefind` skips the final
indexing pass, useful while iterating on everything before it.

Port CI binds any named tree to one source checkout. All identity inputs are
required together; branches, PRs, tags, and aliases are refused without them:

```console
$ LIBTMUX_DOCS_PORT=ruby \
    LIBTMUX_DOCS_VERSION=pr-42 \
    LIBTMUX_DOCS_VERSION_KIND=pr \
    LIBTMUX_DOCS_SOURCE_REF=0123456789abcdef0123456789abcdef01234567 \
    LIBTMUX_DOCS_SOURCE_SHA=0123456789abcdef0123456789abcdef01234567 \
    LIBTMUX_DOCS_IS_DEFAULT=false \
    LIBTMUX_DOCS_CHECKOUT_RUBY=/workspace/source \
    ./scripts/build-site.sh \
    --ports ruby \
    --versions pr-42 \
    --skip-refs \
    --skip-pagefind
```

An alias also sets `LIBTMUX_DOCS_RESOLVES_TO` to the immutable tag it names.
The preflight verifies the ref, SHA, checkout HEAD, native export, API model,
staged guides, examples, manifest identity, canonical URLs, and robots policy
before producing the version subtree.

## Checks

### Versioned tmux manual

The command reference uses the revisions in `site/src/data/tmux/versions.json`.
Each snapshot combines that revision's manual with the corresponding binary's
`list-commands` output. The generator starts and cleans up a private server.
It also retains the upstream license and command source locations.
The original `revision` pin is retained separately from its peeled
`sourceCommit` and `sourceTree`. File links use the commit because GitHub's
file endpoints do not accept annotated tag object hashes.

With mandoc 1.14.6 and binaries installed as `<binaries>/<version>/bin/tmux`,
regenerate the committed snapshots:

```console
$ node scripts/gen-tmux-manual.mjs --source ~/study/c/tmux \
    --binaries ~/.local/share/libtmux-tmux-matrix --mandoc mandoc
```

Verify that the snapshots match both the pinned source and installed binaries:

```console
$ node scripts/gen-tmux-manual.mjs --source ~/study/c/tmux \
    --binaries ~/.local/share/libtmux-tmux-matrix --mandoc mandoc --check
```

The formatter's build date and host labels are excluded. Command syntax,
descriptions, manual anchors and the source hashes remain version-specific.

### tmux options, hooks and format variables

`gen-tmux-catalog.mjs` extracts the catalog behind `/tmux/<version>/catalog/`
for each release in `site/src/data/tmux/versions.json`. Existence, scope, type,
defaults, ranges and source lines come from `options-table.c` and `format.c`
at the pinned commit, with hook firing sites found in the C sources.
Descriptions come from the manual snapshot, whose `manualSha256` must match
`tmux.1` at that commit. It needs a tmux checkout, not mandoc or binaries.

```console
$ node scripts/gen-tmux-catalog.mjs --source ~/study/c/tmux
```

Verify the committed data. Without `--source` this checks digests and shape;
with it, the script regenerates and fails when the committed JSON is stale:

```console
$ node scripts/gen-tmux-catalog.mjs --check --source ~/study/c/tmux
```

`gen-tmux-catalog.negative.mjs` proves the check fails on stale data.

### Which library methods send a tmux command

`gen-tmux-usage.mjs` records, per port, the public symbols whose source sends
each tmux command and at which scope, in `site/src/data/tmux-usage/<port>.json`.
It reads each port's source at the revision its API model was extracted from,
through the port checkouts named in `ports.ts` or
`LIBTMUX_DOCS_CHECKOUT_<PORT>`. Tree-sitter reads the source of most ports;
Julia, F# and Elixir have no grammar here, and `lib/tmux-usage-lexical.mjs` reads
them by their text. `GRAMMARS` in `lib/tmux-usage-scan.mjs` names the reader of
every port that has an API model. The generator fails by name for a port the
table lacks, and for a grammar `scanSource` does not read, and a test dispatches
every grammar of the table, because a port with no reader would be generated as
sending nothing.

A command is recorded for a symbol only where it is sent. A literal that names
a command is a send when it is an argument of a call that dispatches, in the
same statement (`self.cmd("list-panes", ...)`, `run(core, Command::new("..."))`),
or when it builds a command value, bound to a name or returned, that the same
function then passes to one. The entry cites the line of that dispatch call, not
the line that spells the command. The dispatching calls of each port are in
`tmux-usage/dispatchers.json`, each with the lines of the pinned source that
show it sends what it is given (`kind: "builder"` names the calls that only
make a command value: `Command::new`, `TmuxCommand(...)`). A dispatching call is
a name, and a scan reads every call of that name as a send, so each definition a
rule cites must reach a transport: the point where the library starts the tmux
process or writes the command to a control client (`TRANSPORT` in
`lib/tmux-usage-dispatch.mjs`). The rule cites the chain, one line per hop, and
every hop is read back against the pinned source. A hop calls the next function
(`calls`), and the call on its line is resolved as a derivation resolves a call:
by what it is made on, and among the overloads of one type by the arguments it
passes (their number, and for Swift their labels), so `cmd(argv)` is not
`cmd(snapshot, argv)` and `span.run(...)` is not the `run` that spawns. A call
made on a field that holds a handle the scan cannot type (`self.executor.execute`,
`_dispatcher.ExecuteAsync`) says what it holds in `on`, which must be the type of
the function the chain goes on in, and which the call's own receiver must not
contradict; a free function is named by its file and a Julia method by the type of
its first argument. A hop that is not a call the scan can resolve (a trait object,
a delegate, a command put on a queue that another thread writes from, a Ruby
method called by its bare name) is a `leads`, and says why in `why`. A function
that shares a name with a dispatcher and sends nothing (a serializer called
`list`, a log helper called `run`) is not one, and a rule that cites it fails for
citing no chain to a transport.

A dispatching call may take an argument that only names the command for a
failure message (`listing::mutate(core, "find-window", command)`). A rule lists
those positions as `labels`, each with the parameter that takes it, and a
literal there is not a send, is ignored when the call is judged to name another
command, and is skipped by the nested-command rule below. A literal that
reaches no dispatching call sends nothing, and is not a site:

- a command compared against or named by a `case`;
- a row or format selector (`get_output_format("list-sessions", ...)`);
- a label or the argument of a call that checks or fails (`validate...`,
  `failed(...)`, `...Error`, a `throw`);
- a command chosen among others by a ternary, a `match` arm or a receiver's
  class (`is_a?(Hooks) ? "set-hook" : "set-option"`), unless every alternative is
  the same command (`detach-client` with and without `-E`);
- an argument of a helper that never dispatches it.

A helper that builds a command and returns it sends nothing itself: its caller
sends it, and is credited with three lines, the dispatch call, the call of the
helper and the literal. A command that sits in the arguments of one that runs
commands (`if-shell`, `run-shell`, `set-hook`, `bind-key`, `command-prompt`,
`confirm-before` and the like) is not sent either: in
`["if-shell", "-F", cond, quoteCommand(["resize-pane", "-Z"])]` the library
sends `if-shell`, and tmux runs `resize-pane` when the condition holds. That is
the entry for a conditional the method exists to make, such as killing a pane
only if its window is not shared: the library sends `if-shell`, and the command
inside it is a conditional entry that says when.

A function that builds the same `if-shell` to make tmux refuse a stale or
foreign target (`IncarnationFence.guarded`, `guardedAction` in Swift, `execute_link` in Ruby) is
a guard, and is transparent: the library means the command inside it, so the
entry is the inner command, cited through the guard's hop, and the `if-shell` is
not recorded. `tmux-usage/guards.json` declares the guard functions of each port
with the lines that show each builds the wrapper and where it sits; generation
fails when a function builds no `if-shell`, when the cited lines do not hold the
text, or when a guard that only applies on some paths (`conditional`) does not
say `when`. A wrapper that is not declared is not transparent, and the command
inside it is not recorded.

What the scan follows is a literal into a dispatch call in one statement, into
a variable or collection that a later call in the function takes, and out of a
helper that returns it to the one call that dispatches it. A command that is
handed to a helper that dispatches it (`record(names, batch, options)`), that
passes through a second helper that only returns it, or that is started as a
process (`Process.spawn`, `posix_spawnp`, `exec.Command(...).Start()`) is a claim,
because no call named in `dispatchers.json` takes it.

A symbol that calls a function that sends is credited with the command at one
more hop for each call. A hop is matched by the function the call resolves to,
not by its name: an unqualified call or one on `self` is the caller's own
type's, a call on a handle named for a type is that type's, and a call on
anything else is left unresolved, so `Pane.split` calling `options.into_command`
is not a call of `CaptureOptions::into_command`.

Two limits bound what the scan finds, and each is a limit on recall: what it
leaves out is not recorded unless a claim records it. `MAX_HOPS` is 1: a send
that a symbol reaches through two helpers is not credited to it (Julia's
`set_option` reaches the `show-options` that checks the option exists through
`_configuration_option_rows` and `_configuration_rows`, so it is a claim).
`MAX_SHARED_BY` is 4: a helper that more than four public symbols reach is not
credited to any of them, because its callers cannot be told apart (Julia's
identity probe at `acquisition.jl:50`). `--report` lists what each limit left out
(`no public symbol reaches it`, `a helper shared by N public symbols`), and a
send that is what a method is for, or that it makes on every call, belongs in a
claim.

Only public API is recorded: a symbol with an underscore name, a `private`
modifier or an internal scope is left out of the scan and refused in a document.
So is a member whose signature spells a narrower visibility (`protected`,
`internal`, `fileprivate`, `pub(crate)`), and in Java, which spells no visibility
for the default, a member declared without `public` (an interface member and an
enum constant are public without saying so).

The files in `tmux-usage/` hold what a scan cannot decide, and each line of
them is verified against the pinned source, so generation fails when one no
longer holds. `--rules <dir>` reads another copy of them, which is how the
negative script seeds a rule that is wrong:

- `claims.json`: a send the scan cannot see (a command named by a template, a
  scope carried by a typed argument, a call into a snapshot, a chain of more
  than one helper). Each claim cites the lines that make it true. A claim that
  names `via` stands on a core library's entry for the same command and scope.
  A send that is an alternative of the method's own purpose and that only
  some arguments reach (`selectWindow("next")` sending `next-window`, `new_session`
  killing an existing session when `kill_session` is set) is a claim that says the
  condition in `when`; `conditional: true` makes the claim fail without one. A send made on the way to
  what the method is for, such as a read of the target before the keys go to it, is
  `incidental`: it is on the method's page, and the command's pages do not list the
  method for it.
- `forwarders.json`: the wrappers that stand on a core library, Kotlin and
  Scala on Java, F# and the PowerShell cmdlets on C#. A wrapper that calls a
  core method that sends is credited at the core's scope, with both hops as
  evidence; a wrapper that only builds a request sends nothing and is named in
  the page's "No method in" line.
- `exclusions.json`: the symbols whose scanned send is not what a default call
  does: a probe that runs only when a flag or a tmux release asks for it
  (`capture` asking `list-commands` whether a flag exists),
  a branch that the caller's argument never takes (`exitCopyMode` reaching the
  `copy-mode` branch of a helper that `enterCopyMode` shares), or a request
  option that a wrapper never sets. Each cites the lines that show the guard,
  an exclusion that removes nothing fails, and `commands` limits it to those
  commands of the symbols it names. A send that a call makes whether or not the
  caller asked for it is not an exclusion, even when the method only makes it to
  prepare the call: it is `incidental`, as the command-alias inventory a guarded
  Ruby call reads before it sends is (`show-options` and `list-commands`, on the
  same nine symbols). `Session#kill` reads it only when it is given expected
  windows or panes, since its default call takes `super`, so its two entries say
  `when`.
- `dispatchers.json`: the calls that send what they are given, per port, and the
  calls that only build a command value. Each cites the lines of the pinned
  source that show it and, for a call that sends, the chain from there to a
  transport; generation fails when one no longer holds.
- `guards.json`: the functions that wrap a command in `if-shell` to refuse a stale
  or foreign target, which the scan sees through (above).
- `conditions.json`: the condition of a send that the scan finds. It qualifies an
  entry that already exists (a scanned or reviewed one) with a `when` and the
  lines that show the condition, such as `Pane.sendKeys` asking `list-panes` only
  when the pane is synchronized. One that qualifies no entry has gone stale and
  fails. Julia's generic functions take several receiver types, and a symbol is
  credited with a send only for the methods that make it: the derivation records,
  for each entry, which methods of the function send it, which only reach it
  through more calls than a symbol is credited across (`deep`, and the entry
  stands for them), and which reach it by no call at all (`lacks`). A send that
  every method makes takes no qualifier. One that some methods demonstrably do not
  make says `on a Server` or `on a ControlConnection` in a condition with a
  `receiver`, which fails unless the methods that send it take that type, another
  method is shown not to reach it, and the condition cites the body of one of each
  (`through`: the line the method ends on), because a signature line names a type
  and shows neither. A method that may reach it only through a call the scan does
  not resolve leaves the question open, and fails until it is settled by a claim.
- `not-senders.json`: why a public method whose own name carries a command has
  no entry for it, one of `builds` (it builds a command for a caller, or only
  holds one), `other-command` (it sends a different command, or runs it only
  inside the arguments of one that runs commands, or passes its name to choose
  the format of the row it reads),
  `values` (a field or a value holder), `no-send`, or `version-gated`. Each
  cites the lines that show it, and a review that settles nothing is stale and
  fails.

A `when` is at most eight words on one line, because the usage table shows it
beside the method (a muted qualifier on the chip, and after the command link on
a method page); a longer reason belongs on a page. An entry that is conditional
cannot be rendered without it. Each scope of a send says its own condition: on a
method page the item for that scope ends with it in parentheses
(`list-panes -s, cmd_list_panes_session (the spec names a first window)`), in the
Markdown the scope is followed by its own parenthesis, and in the usage table it
sits beside the chip. A command sent at two scopes under two conditions says each
beside its own scope, and a condition that every scope shares is said again on each,
so that no item has to be read with another. Writing a `when` for a condition that
is always true of the method (`Hooks#unset` sending `set-hook` "on a Hooks")
qualifies nothing.

The same rule applies to a tmux release. A send made on every supported release
but some says which in `when`. That includes a command that exists on a supported
release and that the library refuses to send there:

- `Shell.capturing` refuses from tmux 3.3 until 3.5, a range (the guard is
  `atLeast(3.3) && !atLeast(3.5)`, so 3.3, 3.3a and 3.4 all refuse): "except from
  tmux 3.3 until 3.5".
- `Pane.paste` and `Buffers.delete` refuse before 3.4, where deleting a buffer by
  name can remove another, so `load-buffer`, `paste-buffer` and `delete-buffer`
  say "except before tmux 3.4" in Java, Kotlin and Scala, and so does Lua's
  `Server:delete_buffer`. Go's `ConfirmBefore` and `CommandPrompt` always send
  `-b`, which tmux has from 3.3, and refuse before it: "except before tmux 3.3".

A command that does not exist before a release needs no `when`. tmux has no
`new-pane` before 3.7, so the `new-pane` entries of C# and Go (which refuse by
version before sending) and of Python (which sends it and lets tmux refuse) carry
none, and neither does a command the library finds missing in `list-commands`
(Java's `show-prompt-history`): the command's page is the manual of the releases
that have it, and a method does not send the command on a release that lacks it
in a way that differs from what it does on the others. A refusal that depends on
an argument (a layout preset, a client filter, a flag newer than the release) is
not what a default call does, and is neither a `when` nor an entry. A send made on
one release only, such as the rename that `breakOut` adds on tmux 3.7 to give the
window the name that release ignores, is an exclusion, because it is not what a
call does on the others.

Go's wrappers that call a method of another type on a handle named for it
(`p.server.X()`) are credited with that method's entries, as a wrapper on a core
library is, when the call is made on every call of the method and not under a
branch, a loop or a deferred cleanup; the entry names the callee in `via` of the
same port.

An entry records what the default call sends, on every tmux release the port
supports at its revision. What an argument changes (`new_session` killing an
existing session of the same name, `breakPane` sending `if-shell` when no
`named:` is given) belongs to a claim that says the condition in `when`, and so
does a read the method makes of the server for its own argument, marked
`incidental` (go's `NewSession` and `NewSessionConnection` listing sessions to
find the name they were given). An exclusion is for a probe that asks the
running tmux whether it knows a flag the caller set (`capture` asking
`list-commands`), and for a branch the caller's argument never takes. An
exclusion and a claim for the same symbol, command and scope contradict each
other: the exclusion removes the claim's entry, which is how a claim recorded
once and never shown was found. The scan
does not tell a send guarded by a parameter from an unguarded one, so these were
found by listing every entry whose cited lines sit under an `if`, a `case` or a
loop and reading each; a guard written as an early `return` or `next unless`
before the send is not found that way. Among several sends of one command in a
function, the entry cites the one reached by the fewest calls and then under the
fewest branches. A method that sends one command on some of
those releases and another on the rest
is `version-gated`, and is recorded as neither; its review cites the gate, both
branches and the line that sets the supported floor below the gate, so that the
range the gate splits is shown to be supported. When a later revision raises the
floor past the gate, the fallback is gone and the method is recorded as sending
the command that remains. A refusal below some release is not a gate of this kind,
because no other command takes its place: the entry says `when` if the command
exists on the releases it refuses, and says nothing if the command does not exist
there (above).

A claim, an exclusion or a review without a `revision` is read against the
revision its port's model was extracted from. One with a `revision` is read
against that revision instead, which is how a wrapper that shares a repository
with its core library is given the core as it stood where the wrapper is
pinned: F# is pinned at an older revision than the C# model, so its entries stand
on the C# library read there, with the claims and exclusions that carry that
revision. A wrapper in another repository, such as the PowerShell cmdlets,
stands on the release it depends on. Every `via` names the revision of the core
lines it cites.

A claim's evidence names the line that sends, `has` its text, and `span` the
following lines of the same statement that may hold the rest when a call spans
lines: the first text must be on the cited line itself.

`--check --source` also reads back every line each entry cites, at the revision
it names, and refuses the entry when the line does not say what the entry
claims: a scanned entry's first line is a dispatch site of the scan of that file
(a call that sends the command, not a line that spells it), and each later line
is a call of the function around the one before it, resolved by receiver and not
by name; a reviewed entry's lines hold the text its claim names, a forwarded
entry's own line calls the core method and its `via` is read as an entry of the
core at the revision it names, and no entry's first line reports a failure
(`throw`, an error constructor, `failed(...)`) or, for a claim, binds the command
to a name in a function that goes on to send it. It reads the entries as
committed, so an error made in generation that regeneration reproduces is still
seen. `gen-tmux-usage.negative.mjs` replays an entry cited at each kind of line
that is not a send, against the sources, and expects the audit to refuse it.

A method named for a command and recorded as sending nothing of it is how a
miss is found, and the check refuses it until a claim records the send or a
review says why there is none. Nothing is listed by its name: the name only finds
the candidate, and the lines decide. `--check` runs the sweep from the committed
data, `--check --source` also reads each review's lines, and a method named for
one command that the data records as sending the command it also names is not a
candidate for the other.

The command pages list a method that sends directly, a reviewed claim, and a
method that sends through one helper when its own name carries the verb of the
command (`Pane.sendKeys` for `send-keys`, not a method that lists panes to
refresh itself). Every send through a helper is on the method's page.

Every command of the pinned manuals is recorded (`COMMANDS` in the script is
`all`). `site/src/data/tmux-usage/scopes.json` gives the commands that tmux
dispatches by scope their scopes and C functions, checked against both pinned C
models; a command without scope helpers has one column.

```console
$ node scripts/gen-tmux-usage.mjs
```

Verify the committed data. Without `--source` this checks shape and revisions;
with it, the script regenerates from the checkouts and fails when the data is
stale. `--report` lists the sends that no public symbol was credited with, and
`--commands a,b` (or `all`) records other commands, which is how a command is
added to the pages.

```console
$ node scripts/gen-tmux-usage.mjs --check --source
```

`gen-tmux-usage.negative.mjs` proves the check fails on each kind of stale
data, and on each kind of wrong rule: a dispatcher that reaches no transport, a
hop that does not hold its text, a label that names no parameter, a conditional
that does not say when, a condition that qualifies nothing, and a guard that is
not one or has been dropped.

### Site checks

Four scripts assert things the build itself cannot notice. None of them needs
an assembled site; all four are fast enough to run before a commit.

```console
$ node scripts/check-citations.mjs
```

Every source path the prose cites must exist in the port it names — the
`file="…"` fences, the `// From <path>` comments, and each page's "Where this
comes from" table. A fence read from a checkout fails the build when its file
disappears; a hand-quoted one does not, and that is the gap this closes. It
does *not* require a hand-quoted excerpt to match its source byte for byte:
several are excerpts with a clarifying comment added, which is what those
tables already say.

```console
$ node scripts/gen-mcp-tools.mjs
```

Regenerates `site/src/data/mcp-tools.json`, the cross-port MCP tool matrix
`/mcp/tools/` renders. Pass `--check` to fail instead of writing when the
checked-in file is stale. It refuses to write a matrix unless its Python rule
reproduces libtmux-mcp's own documented tool set name for name, every port
declaring a wire prefix carries it on every tool, and every configured MCP
checkout is present — a partial matrix looks exactly like a finding. Ports
whose product status is unpublished, such as Lua, are excluded explicitly.

```console
$ node scripts/gen-registry.mjs
```

Regenerates `site/src/data/registry.json`, which records what each port's
package registry carries right now: a stable release, a prerelease only, or
nothing at all. `installCommand` in
[ports.ts](../site/src/lib/ports.ts) composes that with the install spellings
to produce the command a page or an agent prompt shows, so the command cannot
name a version the registry does not have.

It matters because most ports have no stable release, and several
resolve nothing unless the prerelease is named: Cargo treats an alpha as out of
range for a plain requirement, `go get` without a version resolves the highest
release and a prerelease is not one, and SwiftPM's `from:` excludes prereleases
from its range.

The published site does not read the committed file. `deploy-shell.yml`
resolves the registry against the live registries on every deploy, including
a scheduled one four times an hour, and publishes the result as `/registry.json`; a
release therefore reaches the site without a commit here. The committed file
is what pull requests, local builds and tests use, so their results never
depend on another repository publishing, and nothing requires refreshing it.

Pass `--check` to fail instead of writing when a file differs from what the
script would write. Pass `--offline` to re-emit the baseline without contacting
any registry, for a job that must not depend on ten third-party services; the
test gate runs `--check --offline`. Pass `--baseline <file>` to fall back on a
file other than the committed one, as the deploy does with the copy it last
published. A probe that fails for one port keeps that port's baseline entry
rather than reporting it unpublished, the same way `gen-versions.mjs` falls
back to its seed.

Hex lists a release and, apart from it, the retirements of the package. A
retired release is not offered, and its tag is not recorded.

A tag is recorded only once the registry carries its version. A port tags
first and publishes minutes later, and a tag with no package behind it would
send an install command to nothing. A baseline tag the repository does not
carry is dropped, so a port with no release tag records none and installs from
its default branch.

`gen-registry.negative.mjs` resolves each state Julia can be in, including a
final tag that General does not carry yet, and requires every badge to read the
result. A build fails on an entry its badges cannot read, and only the deploy
resolves live tags, so a pull request meets that failure here.

Release tags are read per port. Rust is a Cargo workspace and tags each crate
(`libtmux@v0.1.0-alpha.10`); Go is multi-module and tags submodules under a
path (`mcp/v0.0.1-alpha.9`) while the library tags bare. `tagPrefix` in
ports.ts declares the first case, and its absence rejects any tag carrying `/`
or `@`, so a submodule's release is never read as the library's.

Assemble a complete preview:

```console
$ LIBTMUX_DOCS_LOCALES_ROOT=/pr-42 \
    LIBTMUX_DOCS_VERSION=pr-42 \
    LIBTMUX_DOCS_VERSION_KIND=pr \
    pnpm build:site --versions latest
```

Audit the assembled preview before publishing:

```console
$ bash scripts/check-preview.sh _site pr-42
```

Checks the actual preview artifact for URLs escaping its prefix and internal
links whose pages or fragments are missing. The deployment workflow runs this
audit before uploading the complete preview, including its port/version trees.

```console
$ node scripts/audit-site.mjs && node scripts/crawl-site.mjs
```

These two do need an assembled `_site/`: the first flags empty, thin and
admonition-rendering pages, the second follows every internal link from `/`.

## Version manifest

`site/public/versions.json` is a committed seed with a `latest` trunk entry
per port, so the version switcher (see
`site/src/components/VersionSwitcher.astro`) has something to render
before any real deploy has produced a richer manifest. `build-site.sh`
regenerates a fuller one from the checkouts it finds and writes it over the
seed at `_site/versions.json`, so a local assembly shows real tags where a
checkout is present.

To regenerate the manifest by hand, or to check what a fresh derivation
looks like:

```console
$ node scripts/gen-versions.mjs
```

Writing straight to a file instead of stdout:

```console
$ node scripts/gen-versions.mjs --out site/public/versions.json
```

Entries are derived per port from each checkout named in
`site/src/lib/ports.ts` (`~/work/python/libtmux`, and so on): git tags
matching that port's grammar become `tag` entries, local branches matching `vX.x`
become `branch` entries, the checkout's current `HEAD` is always `latest`
(kind `trunk`), and `stable` is an `alias` resolving to the newest
non-prerelease tag. A prerelease-only port gets `next`; it does not get a
fabricated `stable`. RubyGems and LuaRocks release spellings keep their native
forms. A port whose checkout is absent falls back to the same latest-only seed
that `--seed` produces, with a note on stderr. Set
`LIBTMUX_DOCS_CHECKOUT_<PORT>` to derive refs from an exact CI checkout.

To regenerate the committed seed itself (only needed if the manifest shape
in `site/src/lib/versions.ts` changes):

```console
$ node scripts/gen-versions.mjs --seed --out site/public/versions.json
```

`--overrides <path>` merges a partial manifest over the derived one —
entries merge by `slug` within each port, `defaultVersion` keys replace
outright:

```console
$ node scripts/gen-versions.mjs --overrides overrides.json
```

## Search index

The assembly runs Pagefind over the locale tree after shell and native
pages are assembled. `--skip-pagefind` omits that pass. Development and
partial builds can have no index; the search panel reports the missing
index instead of implying that the current page contains no matches.

The search bundle uses the locale root, including a PR preview's prefix,
so port and version pages share the assembled index.
