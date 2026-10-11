---
port: "powershell"
route: "concepts/captured-state"
title: "Captured state and I/O"
description: "Separate explicit reads from local object traversal and preserve snapshot boundaries."
sidebar: {"label": "Captured state and I/O", "group": "Concepts", "order": 2}
tableOfContents: true
---

A captured object describes what tmux reported during a read. Accessing its
properties does not refresh it. This makes formatting, filtering, and inspecting
a saved graph predictable even after the daemon has stopped.

## Choose the read boundary

| Operation | What happens |
| --- | --- |
| `New-TmuxServer` | Describes an explicit endpoint without contacting tmux. |
| `Connect-TmuxServer` | Discovers the generation of an unmaterialized handle; an already connected handle is returned unchanged. |
| `Get-TmuxSnapshot` | Acquires a new object graph at the requested depth. |
| `Get-TmuxSession`, `Get-TmuxWindow`, `Get-TmuxPane` | Read the selected owner through their command-specific acquisition path. |
| Property access, formatting, or `Select-TmuxPane` | Use captured values locally. |

Keep one snapshot when several decisions must refer to the same captured graph.
Repeated reads can observe different names, placements, or active panes. Taking a
new snapshot returns a replacement graph; it does not update objects retained
from an earlier capture. See the [read guide](../../guides/read/) for the owner
accepted by each read cmdlet.

## Missing capture is not an empty collection

The default snapshot depth reaches panes. Shallower depths reduce the acquired
state, but relationships below that depth are unavailable. Check their
[`IsCaptured`](/csharp/latest/reference/libtmux-capturedrelation-iscaptured/)
state before using them. Enumerating an uncaptured relationship
raises an error; it does not return an empty list. Required uncaptured fields
likewise fail instead of inventing a value.

A captured empty list means the read found no children. A captured nullable
active child can have no value. Those results differ from a relationship that
was never acquired. Use the native captured-value contract when that distinction
matters, and choose a nullable convenience projection only when treating missing
capture as no value is intentional.

## A snapshot is a bounded observation

Acquisition takes several tmux commands. The library rejects contradictions it
can detect, such as inconsistent parent or child counts, but concurrent changes
can escape those checks. A snapshot is not an atomic transaction or a reservation
of the objects it contains.

Capture metadata records depth, generation, wall-clock boundaries, and elapsed
time. Use elapsed time for duration; the wall clock can move while a read runs.
Take a fresh snapshot after mutation or event loss when your next decision needs
current topology.

Run [create windows and panes](../../examples/create-layout/) to create a graph,
read it once, and traverse its windows locally. The
[`Get-TmuxSnapshot` reference](../../reference/libtmux-get-tmuxsnapshot/) gives
the supported depth and parameter details.
