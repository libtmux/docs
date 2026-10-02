---
port: ts
route: guides/querying-and-filtering
title: Querying and filtering
description: Choose a target and handle missing or ambiguous results.
sidebar:
  label: Querying and filtering
  group: Guides
  order: 6
tableOfContents: true
---

Take a snapshot with `Server.snapshot`, then use `snapshot.sessions.one` with
an exact name predicate. The complete program reports an absent result and
leaves the existing tmux server running. A snapshot describes the read that
created it; later commands can still fail if an object has disappeared.

<a id="filling-in-the-rest-of-the-cardinality-table"></a>

## Require exactly one match

[Attaching to tmux](../attaching-to-tmux/) provides the complete TypeScript program
and its setup. It searches an existing server for `work`, prints the name and
reports an absent session. Its launcher checks that the server remains running.

For a more general predicate, decide whether zero or several results are valid
before indexing a collection. Keep lookup and command failures visible: another
client can change the server between a read and the operation using its result.

<a id="declarative-filters-that-travel-beyond-python-and-typescript"></a>

## Declarative filters

[Filtering and queries](/concepts/queries/) describes this port's query APIs,
accepted fields and result-count contracts. Use that contract when storing a
query in configuration.

## Case-insensitive matching

Choose case handling explicitly when your query needs it. The attach program
uses exact case because the intended session is named `work`.

## Push the filter into tmux, or read once and filter locally

A tmux-side filter reduces returned rows; a captured collection can answer
several local queries from one read. Neither reserves the result. Check
unexpectedly empty format values before assuming that an object does not exist.
