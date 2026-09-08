---
title: Rust MCP topics
description: Understand surface tiers, confirmation, streaming effects, and background command handles.
port: rs
product: mcp
sidebar:
  label: Topics
  order: 1
---

Rust's MCP server uses an ordered surface tier chosen once at launch.
The tier limits available operations, while the target tmux server and
pane programs still run with the user's authority.

## Surface tiers and confirmation

`readonly` offers read operations. `mutating` is the default and adds
input, creation, and configuration. `destructive` adds dedicated kill
tools and destructive plan operations.

`run_plan` keeps the same name at each tier and validates every operation
before running any. `--confirm` adds client elicitation before dedicated
kill tools and destructive plan operations; these fail closed when the
client cannot ask. It does not inspect shell commands for equivalent
effects.

Invalid safety values select `readonly`. Invalid confirmation values
enable confirmation. The flags override their environment counterparts,
`TMUX_MCP_SAFETY` and `TMUX_MCP_CONFIRM`.

## Live reads change attachment state

`watch_pane`, `wait_for_text`, `wait_for_idle`, and `capture_since`
attach control clients without updating the session environment. Attachment
is still observable and can invoke configured hooks. The `readonly`
tier withholds these tools.

`capture_since` retains its client between reads. Reuse its cursor and
check `missed` for dropped output. An ordinary capture and a persistent
live observation have different lifetimes.

## Command deadlines and jobs

`run_command` returns command output and exit status. At its deadline it
returns a job handle rather than stopping the shell command.
`start_command` returns a handle immediately. Follow either with
`job_status`.

`forget_job` stops collection and discards retained output. It leaves pane
activity running. A stale target requires a fresh listing; a
`partial_effect` error requires inspection before another action.

## Resources and prompts

Hierarchy resources expose the selected server, sessions, windows, panes,
and pane content. The mutating and destructive tiers offer
`run_and_wait`, `interrupt_gracefully`, and `diagnose_pane`; readonly
offers `diagnose_pane` alone.

[Source contract](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-mcp/README.md).
