---
port: "fsharp"
route: "topics"
title: "Topics"
description: "Understand native .NET identity, task cancellation, and control-stream ownership."
sidebar: {"label": "Overview", "group": "Topics", "order": 1}
tableOfContents: false
cards: [{"label": "Native identity and ownership", "href": "./ownership/", "body": "Pass core handles without conversion and close only what the scope owns."}, {"label": "Tasks, cancellation, and retry", "href": "./execution/", "body": "Preserve dispatch evidence and distinguish one command from a multi-step operation."}, {"label": "Streams and live state", "href": "./observations/", "body": "Choose waits, output streams, or a mirror and handle gaps and cleanup."}]
---

F# helpers use the core .NET entities and exceptions directly. These topics
explain how that affects task execution, resource cleanup, retries, and event
consumption.

Use [Concepts](../concepts/) for complete programs that exercise the object model,
queries, and command transports. Use the [API reference](../reference/) for
individual functions and their corresponding .NET types.
