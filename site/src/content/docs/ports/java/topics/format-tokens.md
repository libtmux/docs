---
port: java
route: topics/format-tokens
title: Format-token fields
description: The typed fields every object exposes, mirroring tmux's own format tokens, and why a field is sometimes absent.
sidebar:
  label: Format-token fields
  group: Topics
  order: 7
tableOfContents: true
---

Object fields expose values from tmux's
[FORMATS](https://man.openbsd.org/tmux.1#FORMATS), such as `pane_id`,
`window_zoomed_flag`, and `session_name`. The available fields depend on the
accessor, object scope, tmux version, and data requested by the read.

A token needs the right **scope** and **tmux version**. For example, a pane
token needs a pane context, and a token added after your tmux release may be
absent. Check the accessor's result before using a field that can be missing, as
described below.

<a id="the-absence-idiom-per-port"></a>

## Handling an absent field

Accessors use `Optional<T>` for fields that may be unavailable.
For example, `Pane.floating` returns an empty `Optional<Boolean>` when
that field is not populated.

These examples read optional fields, including `pane_dead_signal` on tmux 3.3 or
newer:

```java
pane.floating(); // Optional<Boolean>: a different field, same idiom: empty
                  // rather than a sentinel when the token isn't populated
```

<a id="a-generated-table-under-the-accessor"></a>

## Field availability

Field accessors retain the scope and version requirements of tmux tokens.

Version gates describe tmux behavior: `pane_dead_signal`
and `pane_dead_time` arrived in tmux 3.3, and a cluster of pane-geometry and
floating-pane tokens (`pane_floating_flag`, `pane_pb_progress`, `pane_x`,
`pane_y`, `pane_z`, `pane_zoomed_flag`, `bracket_paste_flag`,
`synchronized_output_flag`, among others) arrived together in 3.7.

## Fields promoted from the active child

tmux's format engine includes active-child fields when listing a parent. A
`list-sessions -F` row can include `window_id` and `pane_id` for the active
window and pane. Check the port reference for typed access to those fields, or
use the explicit relationships described in [Traversal](../traversal/).

A pane context can include parent window and session fields. A session cannot
identify one attached client when several clients may be attached, so client
tokens such as `client_name` require a client context.
