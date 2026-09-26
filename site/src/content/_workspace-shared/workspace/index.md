---
title: "Workspace Manager overview"
description: "Workspace manager overview."
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
ports:
  py:
    title: "Workspace Manager for Python"
    description: "Create, load, and export tmux workspaces with tmuxp."
  ts:
    title: "Workspace Manager for TypeScript (in development)"
    description: "Build the local TypeScript tmux-workspace CLI; implementation coverage remains partial and unreleased."
  rs:
    title: "Workspace Manager for Rust (in development)"
    description: "Build the local Rust tmux-workspace CLI; implementation coverage remains partial and unreleased."
  go:
    title: "Workspace Manager for Go (in development)"
    description: "Build the local Go tmux-workspace CLI; implementation coverage remains partial and unreleased."
  java:
    title: "Workspace Manager for Java (in development)"
    description: "Build the local Java tmux-workspace CLI; implementation coverage remains partial and unreleased."
  dotnet:
    title: "Workspace Manager for .NET (in development)"
    description: "Install the prerelease .NET tmux-workspace CLI from NuGet; implementation coverage remains partial."
  cxx:
    title: "Workspace Manager for C++ (in development)"
    description: "Build the local C++ tmux-workspace CLI; implementation coverage remains partial and unreleased."
  swift:
    title: "Workspace Manager for Swift (in development)"
    description: "Build the local Swift tmux-workspace CLI; implementation coverage remains partial and unreleased."
---
<!-- port:py -->
[tmuxp](https://tmuxp.git-pull.com/) is Python's workspace manager built on
libtmux. A YAML or JSON file describes a session, its windows and panes, and
the commands to run. `tmuxp load` builds that workspace and can attach you to
it or leave it detached.

The application also finds saved workspaces, exports a running session,
converts configuration formats, and supports Python plugins and custom
workspace builders.

## Start here

- [Guides](./guides/) install tmuxp and load a workspace on a dedicated socket.
- [Topics](./topics/) explain configuration, existing sessions, and exports.
- [Examples](./examples/) load YAML and JSON through the CLI.
- [Internals](./internals/) describe the builder pipeline and Python APIs for
  contributors and extension authors.

## Package and documentation

Install `tmuxp` separately from the core `libtmux` package. Let its dependency
resolver choose a compatible libtmux version. The MCP server is another
application with its own requirements, so use separate tool environments when
their dependency ranges differ.

The [tmuxp documentation](https://tmuxp.git-pull.com/) provides the complete
upstream CLI reference, workspace format, and extension documentation.

[Upstream quickstart source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/quickstart.md)

## tmuxp command and configuration reference

The Python command pages document the current tmuxp reference and label proposed native extensions.

- [Installation walkthrough](./guides/installation/) uses the available Python tool.
- [Command reference](./cli/) lists commands, flags, and observed behavior.
- [Configuration](./configuration/) covers fields, normalization, and execution.
- [Example gallery](./examples/gallery/) includes upstream fixtures and prerequisites.
- [Compatibility status](./reference/compatibility/) records native builder gaps.
- [JSON, NDJSON, and color](./reference/output/) defines the proposed native output contract.
<!-- /port -->
<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- port:ts -->
Native services load/reuse/append and capture sessions, discover and search
documents, convert formats, import configurations and run editors. Loading
includes terminal attach/switch, before scripts, progress and diagnostics.
Python shell evaluation and explicit plugin/custom-builder loads use an optional
tmuxp bridge. Ordinary native loads do not start Python. Native command metadata
and Bash, Zsh and fish completion come from the parser; completion starts no
Node, Bun or tmux process.
<!-- /port -->
<!-- port:rs -->
Native services load and capture sessions, discover and search documents,
convert formats, import tmuxinator/teamocil files, and run editors. Python
shells and workspace extensions use an explicit version-checked bridge.
Append validates the current daemon and retains the borrowed session across
inputs.
<!-- /port -->
<!-- port:go -->
Native services provide load/reuse/append, capture, discovery, conversion,
imports, editor execution and search. Loading supports common commands,
directories, environment, options, before scripts and terminal progress.
Native script arguments validate for all inputs before session mutation.
Append authenticates the inherited server and retains one target session across
all inputs. Plugin and custom-builder append use that session through the
checked Python bridge when the document has no `before_script` key.
<!-- /port -->
<!-- port:java -->
Native services load and capture sessions, discover and search documents,
convert formats, import configurations and run editors. Common commands,
layout, environment, before scripts and diagnostics are implemented. Python
shell evaluation and plugin/custom-builder loading use a checked tmuxp bridge.
Human load progress supports
presets, custom templates and a bounded script-output panel. Append keeps its
original target session across input files.
<!-- /port -->
<!-- port:dotnet -->
Native services load/reuse/append and capture sessions, discover and search
documents, convert formats, import configurations and run editors. A checked
Python bridge provides Python-specific shell and workspace-extension behavior.
<!-- /port -->
<!-- port:cxx -->
Native services load and attach sessions, reuse exact names, append windows,
capture topology, discover and search documents, convert formats, import
configurations and run editors. Ordinary search uses C++ regular expressions.
<!-- /port -->
<!-- port:swift -->
Native services discover, search, convert, import, edit, load, append and
capture workspaces. Common directories, command inheritance,
indexes, focus, session environment/options and before scripts are supported.
Python shell evaluation uses a checked tmuxp bridge.

`load -2` forces 256-color handling in native tmux clients. Legacy `-8` is
recognized but rejected before document lookup because supported tmux versions
do not implement 88-color mode. Without `-2`, tmux detects color support.
<!-- /port -->

## Load a workspace from the terminal

<!-- port:ts,rs,go,java,cxx,swift -->Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
<!-- port:ts -->[TypeScript repository](https://github.com/libtmux/libtmux-ts)<!-- /port --><!-- port:rs -->[Rust repository](https://github.com/libtmux/libtmux-rs)<!-- /port --><!-- port:go -->[Go repository](https://github.com/libtmux/libtmux-go)<!-- /port --><!-- port:java -->[Java repository](https://github.com/libtmux/libtmux-java)<!-- /port --><!-- port:cxx -->[C++ repository](https://github.com/libtmux/libtmux-cxx)<!-- /port --><!-- port:swift -->[Swift repository](https://github.com/libtmux/libtmux-swift)<!-- /port -->. It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:
<!-- /port --><!-- port:dotnet -->Install the `LibTmux.Workspace.Cli` prerelease from NuGet:

```console
$ dotnet tool install \
    --global \
    --prerelease \
    LibTmux.Workspace.Cli
```

The [installation walkthrough](./guides/installation/) loads a small workspace
on a private socket. Inspect the command without starting tmux:
<!-- /port -->
```console
<!-- port:ts -->$ node packages/workspace-cli/dist/main.js --help<!-- /port --><!-- port:rs -->$ target/release/tmux-workspace --help<!-- /port --><!-- port:go -->$ ./tmux-workspace --help<!-- /port --><!-- port:java -->$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace --help<!-- /port --><!-- port:dotnet -->$ tmux-workspace --help<!-- /port --><!-- port:cxx -->$ build/cxx-dev/apps/workspace/tmux-workspace --help<!-- /port --><!-- port:swift -->$ .build/debug/tmux-workspace --help<!-- /port -->
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this <!-- port:ts,rs,go,java,cxx,swift -->local <!-- /port -->implementation.

## Current coverage
<!-- port:ts -->

Interactive prompts and complete configuration/platform acceptance remain
unfinished. Python extensions require tmuxp 1.74.0 and report observed effects
without claiming ownership or rollback. See [hooks and builders](./configuration/hooks/)
for append restrictions. Capture reports live state rather than recovering the
original workspace commands or extension intent.
<!-- /port -->
<!-- port:rs -->

Native load supports [filtered file logging](./reference/output/#native-rust-logging).

Human load supports progress templates and bounded script lines. Attachment
checks the terminal and invoking client before mutation. SIGINT and SIGTERM
report completed inputs and acknowledged effects; interruption does not roll
them back. Human bootstrap scripts retain terminal stdin with foreground and
terminal-setting restoration on supported targets.

Human listing supports tree and full views with escaped labels. Native
generation exports command metadata, manuals and completion scripts without
starting tmux or Python. Discovery/search edge cases, complete configuration
coverage and broader platform lifecycle validation remain open. See the
[compatibility reference](./reference/compatibility/) for cancellation and
platform limits.
<!-- /port -->
<!-- port:go -->

Append through the Python workspace bridge with a document `before_script`
key is unavailable and fails during preflight, including empty or null values.
This prevents Python's script-failure cleanup from deleting the borrowed
session. Native scripted append remains supported.

`load -s` changes only the final input's session name; earlier inputs keep
their configured names. Legacy `-8` and `--88-colors` fail before workspace
lookup or runtime checks. Use `-2` to request 256-color mode.

Native Go logging supports `--log-level` and structured `--log-file` output
on Unix. Diagnostic filtering preserves mandatory command errors and machine
results. See the [logging contract](./reference/output/#native-go-logging).

Some cleanup and interruption paths, complete configuration coverage, and
portable packaging still need work. Capture cannot
reconstruct original command arguments, history or workspace extensions.
<!-- /port -->
<!-- port:java -->

Python plugins and custom builders execute through the checked tmuxp bridge.
Extension append rejects documents containing `before_script` to preserve the
borrowed session. Complete configuration/capture coverage and full
terminal/platform acceptance remain unfinished. Progress uses the initial
terminal dimensions; it does not track resizing, and Unicode clipping is
conservative.
<!-- /port -->
<!-- port:dotnet -->

Native [imports](./cli/import/#native-net-imports) preserve supported command
groups, directories, Teamocil options/focus and synchronization timing. They
validate the translated workspace before printing or saving it and refuse
unsupported lifecycle fields. Load creates panes in configuration order;
[pane configuration](./configuration/panes/) explains indexes and focus.

Native `--log-level` filters optional diagnostics. On Linux x64,
`load --log-file` appends structured logs; see the
[output reference](./reference/output/) for destination and failure handling.

On Linux x64, human load shows terminal progress on stderr, with presets,
literal token templates and bounded script output. See
[load](./cli/load/#progress-and-script-output) for counters, stream handling
and resize limits.

Native append retains the current pane's resolved session across all inputs,
even if a script moves the pane. Later commands reject a replacement daemon.
Append with Python plugins or custom builders is unavailable and fails before
building any input or starting Python; use `-d` for those extensions.

Human load supports attachment and client-selection prompts from a foreground
controlling terminal on Linux x64. It authenticates the invoking pane and
selected daemon before building, then checks the client again before handoff.
See [native attachment](./cli/load/#native-net-attachment) for choices and
interruption behavior.

Attached Python extension handoff, broader extension lifecycle validation,
contextual completion, and the full configuration and platform corpus remain
unfinished.
<!-- /port -->
<!-- port:cxx -->

`before_script` runs a quoted command directly after session creation or append
selection, before settings and windows. All inputs are validated first. Script
failure removes a newly owned session and preserves a borrowed append session;
NDJSON streams script output while the child runs.

Human load requires a foreground terminal. It attaches outside tmux or switches
the unique terminal client viewing the invoking pane. The final input selects
the session, including reuse. Output is flushed before handoff; failures retain
loaded changes. See [loading and attachment](./cli/load/#native-c-loading).

Independent `active-pane` focus on the invoking physical window requires `-d`
or `--append`, including linked windows.

`load --log-file PATH` appends JSON diagnostics. Log levels filter optional
records without hiding required errors or changing machine results. See
[logging](./reference/output/#native-c-logging) for file and failure behavior.

Human load has terminal progress with presets, templates and bounded script
output. Native Bash, Zsh and Fish completion covers commands, flags, choices
and paths. Dynamic session/configuration-name suggestions remain unavailable.

Human `ls --tree` groups workspaces by directory; `--full` includes parsed
configuration. The optional [shell](./cli/shell/#native-execution) uses an
installed tmuxp 1.74.0 executable, with streaming and terminal restoration.
Native loading remains independent of Python.

Plugin/custom-builder execution, full importer/configuration
coverage and portable packaging remain unfinished. Capture preserves local
session/window options but omits inherited/global options and environment.
It cannot recover original command arguments or history.
<!-- /port -->
<!-- port:swift -->

`--log-level` filters advisory diagnostics; fatal errors remain visible.
`load --log-file` appends structured lifecycle and diagnostic records to a regular
file. A write failure reports a secondary diagnostic and preserves the load result.

Human load displays progress on terminal stderr, with presets, custom counters
and a bounded recent-output panel. It uses the initial terminal size and
conservative Unicode clipping. Bootstrap output streams to its original stdout
or stderr destination and updates the panel while the script runs. Machine
output disables the panel and sends child text as structured stderr warnings;
load events remain on stdout. See the [child output contract](./reference/output/#native-swift-child-output)
for limits and cancellation behavior.

Human load with a foreground terminal attaches to the final workspace. Inside
tmux, choose switch, detached load, append or cancel. `-y` skips the mode prompt
and refuses an ambiguous client selection. Redirected and machine calls require
`-d` or `--append`. Detaching or interrupting the client preserves loaded sessions.

Plugins/custom builders, further pane/window execution
settings, fuller capture, generated manuals and portable distribution remain
unfinished. Parser coverage does not establish support for every configuration
field or execution path.
<!-- /port -->

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

<!-- port:ts -->The `@libtmux/workspace` library package<!-- /port --><!-- port:rs -->The `tmux-workspace` library crate<!-- /port --><!-- port:go -->The `workspace` library module<!-- /port --><!-- port:java -->The `libtmux-workspace` library module<!-- /port --><!-- port:dotnet -->The `LibTmux.Workspace` library package<!-- /port --><!-- port:cxx -->The `workspace_builder` source consumer<!-- /port --><!-- port:swift -->The `TmuxWorkspace` SwiftPM library product<!-- /port --> remains available for applications that
build sessions through code. [Internals](./internals/) documents that API:

- [Guides](./internals/guides/) show application setup and builder calls.
- [Topics](./internals/topics/) explain supported configuration and behavior.
- [Examples](./internals/examples/) exercise the library or source consumer.
- [API](./reference/) covers the builder and configuration interfaces.

## tmuxp command and configuration reference

Use the <!-- port:ts,rs,go,java,cxx,swift -->local <!-- /port -->CLI's help and the limits above when applying these compatibility
references to native execution.

- [Installation walkthrough](./guides/installation/) <!-- port:ts,rs,go,java,cxx,swift -->builds and runs the local native CLI.<!-- /port --><!-- port:dotnet -->installs and runs the published native CLI.<!-- /port -->
- [Inspect through MCP](./guides/inspect-with-mcp/) connects to the loaded session.
- [Command reference](./cli/) lists tmuxp commands, flags and compatibility targets.
- [Configuration](./configuration/) covers fields, normalization and execution.
- [Example gallery](./examples/gallery/) includes upstream fixtures and prerequisites.
- [Compatibility status](./reference/compatibility/) records builder/reference gaps.
- [JSON, NDJSON, and color](./reference/output/) describes the shared output design.
<!-- /port -->
