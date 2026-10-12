---
port: "scala"
route: "topics"
title: "Topics"
description: "Understand direct calls, Cats effects, client scopes, and stream delivery."
sidebar: {"label": "Overview", "group": "Topics", "order": 1}
tableOfContents: false
cards: [{"label": "Client and effect lifetimes", "href": "./ownership/", "body": "Separate direct facade closure from borrowed Cats Resource release."}, {"label": "Effects, admission, and cancellation", "href": "./execution/", "body": "Know when work runs, how it is bounded, and what cancellation proves."}, {"label": "Observations, gaps, and reconciliation", "href": "./observations/", "body": "Keep FS2 demand, subscription loss, and current state distinct."}]
---

Scala offers direct operations over Java handles and effect-scoped operations
through its companion modules. Choose the execution and ownership model together:
constructing an effect, evaluating it, and reading captured state have different
consequences.

The [concept programs](../concepts/) supply complete runnable examples. These
topics explain the decisions behind those programs and link to the native guides
for the detailed contracts.
