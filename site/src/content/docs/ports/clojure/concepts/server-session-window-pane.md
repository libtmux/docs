---
port: clojure
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: Traverse one captured graph and keep effects explicit through Java references.
sidebar:
  group: Concepts
  order: 2
---

[`open!`][open] returns a closeable Java server client for an explicit socket.
[`snapshot!`][snapshot] acquires a graph of persistent maps. A snapshot contains
sessions; sessions contain window placements; windows contain panes.
[`data/windows`][windows] and [`data/panes`][panes] traverse that capture
without another tmux command. Ordinary keyword lookup reads its scalar fields.

Maps retain an opaque Java handle at `:tmux/ref`. Pass that reference to an
effect such as [`rename!`][rename]. Editing an ID in a map changes the map;
it does not change the target authenticated by its reference. The old map
keeps its earlier name after a rename. [`refresh!`][refresh] acquires a new
observation.

A linked window can occur in several sessions. [`same-entity?`][entity]
compares physical identity; [`same-link?`][link] also compares its placement.
Keep input order and repeated placements when processing the graph.

Use native collection functions to filter captured values. When a Java
`FilterExpr` already exists, [`matching`][matching] adapts it to a Clojure
transducer or lazy sequence. [`exactly-one`][one] checks cardinality before an
effect. [`data`][data] removes operational references for detached EDN export.

The [quickstart](../../) demonstrates these operations. The
[captured-value reference](../../guides/captured-values/) lists the keys;
[captures and effects](../../guides/captures-and-effects/) explains ownership,
lazy processing and recovery.

[open]: ../../reference/libtmux-core-open/
[snapshot]: ../../reference/libtmux-core-snapshot/
[windows]: ../../reference/libtmux-data-windows/
[panes]: ../../reference/libtmux-data-panes/
[rename]: ../../reference/libtmux-core-rename/
[refresh]: ../../reference/libtmux-core-refresh/
[entity]: ../../reference/libtmux-data-same-entity/
[link]: ../../reference/libtmux-data-same-link/
[matching]: ../../reference/libtmux-data-matching/
[one]: ../../reference/libtmux-data-exactly-one/
[data]: ../../reference/libtmux-data-data/
