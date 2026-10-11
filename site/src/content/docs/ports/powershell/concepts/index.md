---
port: "powershell"
route: "concepts"
title: "Concepts"
description: "Understand captured objects, stable identities, and local versus remote queries."
sidebar: {"label": "Overview", "group": "Concepts", "order": 1}
tableOfContents: false
cards: [{"label": "Captured state and I/O", "href": "./captured-state/", "body": "Know when data was read and distinguish missing capture from an empty result."}, {"label": "Object identity and placement", "href": "./identity/", "body": "Keep daemon identity, physical windows, and session placements separate."}, {"label": "Local selection and source queries", "href": "./queries/", "body": "Choose Where-Object, structured criteria, or an explicit fresh acquisition."}]
---

LibTmux cmdlets return native .NET objects. Learn which operations contact tmux,
which values are captured, and what identifies the object a later command changes.

Start with captured state before building a polling loop or retaining handles
between operations. Then use the [complete examples](../examples/) to run these
ideas against a private server.
