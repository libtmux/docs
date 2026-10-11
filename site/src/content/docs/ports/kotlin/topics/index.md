---
port: "kotlin"
route: "topics"
title: "Topics"
description: "Reason about coroutine execution, resource ownership, and bounded observation."
sidebar: {"label": "Overview", "group": "Topics", "order": 1}
tableOfContents: false
cards: [{"label": "Client ownership and captured state", "href": "./ownership/", "body": "Keep borrowed daemons and owned Kotlin client scopes distinct."}, {"label": "Coroutines and command execution", "href": "./execution/", "body": "Understand suspend calls, admission bounds, and cancellation after dispatch."}, {"label": "Flows and event loss", "href": "./observations/", "body": "Collect within the client scope and handle gaps without assuming replay."}]
---

Kotlin handles combine local captured properties with suspending operations that
contact tmux. These topics explain the boundary, including the Java client
underneath the wrapper and the lifetime of each collected flow.

Start with the [object model](../concepts/server-session-window-pane/) and
[complete examples](../examples/) for runnable programs. Use these topics to
choose cancellation, concurrency, and recovery behavior for a larger application.
