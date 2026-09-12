---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: rs
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The Rust `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

The optional CLI feature provides native load, capture, discovery, search,
conversion, both importers, editor execution and diagnostics. Loading can create
or reuse a session and append windows. The normalizer handles pane and command
shorthand, directories, environment, shells, layouts, indexes, focus, options,
before-script execution and pane-readiness policies. Configuration and failure
handling still need the broader validation listed below.

`--append` validates the inherited `TMUX` and `TMUX_PANE` context before Python
lookup or load events. Every input retains the same borrowed session. Native
execution checks its daemon identity before each input and after `before_script`.
Missing or replaced targets are rejected; separate tmux calls are not atomic.

The CLI rejects `-8` and `--88-colors` before reading workspace files or checking
Python. tmux 3.2a and newer do not support 88-color mode; omit the flag or use
`-2` for 256 colors.

Every command accepts `--json` and `--ndjson`, with NDJSON taking precedence.
Load emits operation records; captured child output remains separate from native
result data. Human output includes semantic colors. Conversion retains document
fields that native execution does not use. Capture records live workspace shape
and warns about information it cannot reconstruct. Search uses Rust's native
`fancy_regex` engine, not Python `re`.

Native load supports [filtered file logging](../output/#native-rust-logging).
Invalid log destinations are refused before tmux or Python runs.

Python shell, plugin and custom-builder behavior uses an explicit bridge that
checks tmuxp 1.74.0. Extension loading reports that Python owns those hooks; it
is not native Rust plugin execution. The bridge preserves a borrowed append
session when the Python bootstrap fails. It validates the retained target before
extension imports and again before building. Extensions can still change live
state through their own code. Editor and interactive Python services
can use a controlling terminal while machine results remain on stdout.

The command graph can generate reference metadata, manuals and shell completion.
Local installation and matched tmuxp measurements have exercised specific
detached-load and capture fixtures on tmux 3.2a and a newer release; they do not
establish the final CLI's complete lifecycle or package contract.

The local source reference is crates/tmux-workspace/src/cli/. Use the native
executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Attached load still checks terminal stdin and selects attach/switch from the
  presence of `TMUX`. It needs terminal refusal before mutation, authenticated
  invoking-client selection and real cancellation/redirected-terminal coverage.
- Progress format/line controls are parsed but their service is incomplete.
  Human control-byte rendering, tree output and output backpressure/early-close
  handling also need completion.
- Discovery precedence, individual pane-command search, YAML merges, extension
  fields and command/directory expansion need broader corpus checks.
- Final installation documentation, packaged generated references, supported
  feature/MSRV/platform gates and interruption accounting remain open.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-rs/tree/4a9afac1d82d9a6a9af16099e7b846e69f0e6388).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 17 of the 23 upstream YAML examples in the original audit.
Command shorthand could leave Enter disabled, implicit and explicit window
indexes could collide, and split panes did not inherit `window_shell` as
required. Serialization and capture could discard unsupported fields. The source
snapshot had no native CLI.

At that baseline, `tmux-workspace` parsed a configuration subset and recorded
unknown keys in `unsupported_keys` without executing them. Its builder created a
new session, and failure after creation could leave partial state. These are
historical library results, separate from the current CLI normalization and
process services.

Read the port's [builder topics](../../internals/topics/) and
[API](../../internals/api/) for its library interface. Use the language switcher
to compare the same topic across ports; each port has its own coverage limits.

## Shared gaps

Parser acceptance does not prove execution support. Native regex engines and
Python plugin runtimes have different contracts; identical flags alone do not
establish compatibility. See [shell](../../cli/shell/),
[search](../../cli/search/) and [hooks](../../configuration/hooks/), and apply
this port's current limitations above when reading those reference pages.

## Optional format separator

Python libtmux exposes `LIBTMUX_TMUX_FORMAT_SEPARATOR` in its format collector.
This native CLI does not claim that setting as a supported codec control. Its
framing and decoding need their own compatible seam and collision, empty value,
Unicode and line-break checks before accepting such a setting.

## Reading examples

The [gallery](../../examples/gallery/) contains the upstream fixture corpus.
Parsing a fixture and executing its applications are separate checks. Several
require external programs, remote hosts, project directories or plugin
packages. A successful YAML read does not establish those dependencies or the
complete workspace behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
