---
port: clojure
route: concepts
title: Concepts
description: Understand Clojure captures, explicit references and resource ownership.
sidebar:
  group: Concepts
  label: Overview
  order: 1
cards:
  - label: Server, session, window, pane
    href: ./server-session-window-pane/
    body: Traverse captured maps and choose the reference used by an effect.
  - label: Captures, effects and streams
    href: ../guides/captures-and-effects/
    body: Own clients, workers and subscriptions; inspect failures before retrying.
  - label: Captured values
    href: ../guides/captured-values/
    body: Look up namespaced fields and distinguish unavailable from absent data.
---

Start with the [object graph](./server-session-window-pane/), then use the
[task examples](../examples/) to apply these contracts.
