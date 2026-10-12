---
port: "powershell"
route: "topics"
title: "Topics"
description: "Make deliberate choices about ownership, command completion, and event streams."
sidebar: {"label": "Overview", "group": "Topics", "order": 1}
tableOfContents: false
cards: [{"label": "Ownership and cleanup", "href": "./ownership/", "body": "Separate borrowed daemons, owned clients, jobs, and created sessions."}, {"label": "Dispatch, completion, and failure", "href": "./execution/", "body": "Choose command chains, control replies, or authenticated shell completion."}, {"label": "Watching output and state", "href": "./observations/", "body": "Bound stream lifetime and memory, then recover deliberately from event loss."}]
---

Use these topics when a script grows beyond a single command. They explain what
your script owns, what a successful return proves, and how to react when a stream
loses data.

For the object model and query boundaries, start with [Concepts](../concepts/).
For executable setup and cleanup, use the [complete examples](../examples/).
