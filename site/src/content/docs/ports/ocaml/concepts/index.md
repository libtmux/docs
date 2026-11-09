---
title: OCaml concepts
description: Understand immutable observations, window links and typed queries.
port: ocaml
route: concepts
cards:
  - label: Captured object graph
    href: ../guides/graph/
    body: Navigate sessions, shared windows, contextual links and panes.
  - label: Local queries
    href: ../guides/queries/
    body: Compose native predicates and typed expressions over captured values.
  - label: Package boundaries
    href: ../guides/packages/
    body: Choose the pure core or optional transports and consumers.
---

Snapshots hold immutable observations. A window can have several session links;
each link retains its own index and context. Process captured collections with
`Iarray`, `Seq` and ordinary functions. Typed expressions add inspectable query
data without replacing those collections.
