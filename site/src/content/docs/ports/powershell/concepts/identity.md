---
port: "powershell"
route: "concepts/identity"
title: "Object identity and placement"
description: "Understand endpoint handles, daemon generations, physical windows, and session links."
sidebar: {"label": "Object identity and placement", "group": "Concepts", "order": 3}
tableOfContents: true
---

Select the endpoint explicitly, then keep the identity returned with its native
objects. A textual pane or session ID alone is not enough to identify an object
across different servers or daemon restarts.

## Endpoint and daemon generation

`New-TmuxServer` accepts an explicit socket selector. It creates a description,
not a daemon. `Connect-TmuxServer` discovers the live generation and returns a
connected replacement when the supplied handle is not materialized. Keep that
returned handle when subsequent work needs the discovered identity.

Pass native objects into mutation cmdlets. Their identity and placement guards
can be retained by typed commands. Reconstructing a command from raw target text
throws away that information. Raw `-Target` on control attachment uses tmux target
syntax at attachment time; it is not the identity of a captured session.

## IDs and names serve different purposes

Session, window, and pane IDs have distinct prefixes. PowerShell expands a dollar
sign in a double-quoted string, so write a session ID as `'$0'` when entering it
literally. A window ID such as `'@1'` and a pane ID such as `'%2'` select different
kinds of object.

The read cmdlets' `-Id` and `-Name` filters are exact and case-sensitive. They do
not interpret wildcards. When both are supplied, both must match. A name can
change; retain the native result when you intend to act on the same object.
See [reading objects](../../guides/read/) for matching and empty-result behavior.

## A window can appear in several sessions

A physical window can be linked into more than one session and can have more
than one placement. Its index belongs to the placement. Do not use a window's
name or one session's index as a global key.

Captured session-window links preserve these occurrences. A physical pane still
belongs to its window; a traversal through multiple session placements can
encounter it more than once. Choose whether your operation is about physical
windows, distinct sessions, or placements before deduplicating results.

Filtering a captured collection changes membership, not the graph referenced by
the selected objects. Parent and sibling navigation still describes the original
capture. Refreshing one pane does not silently recreate an old parent graph;
acquire a new snapshot for a coherent traversal.

The [placement guide](../../guides/placement/) covers links and moves. Continue
with [ownership and cleanup](../../topics/ownership/) before deciding which
resources your application may remove.
