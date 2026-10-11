---
port: "powershell"
route: "concepts/queries"
title: "Local selection and source queries"
description: "Choose ordinary pipelines, reusable criteria, or a fresh daemon-side query."
sidebar: {"label": "Local selection and source queries", "group": "Concepts", "order": 4}
tableOfContents: true
---

Use a local pipeline to inspect data you already captured. Use an explicit source
query when the decision requires a fresh read from tmux. A filter never makes an
old snapshot current.

## Choose the simplest useful query

| Need | Use |
| --- | --- |
| An ordinary PowerShell predicate over existing objects | [`Where-Object`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/where-object) |
| Reusable, inspectable criteria for captured objects | `New-TmuxQuery` and the matching `Select-TmuxSession`, `Select-TmuxWindow`, or `Select-TmuxPane` |
| A fresh acquisition with a query plan | `Invoke-TmuxQuery` |
| The allowed fields and operators | `Get-TmuxQueryField` |

The structured selectors preserve order, duplicates, native object identity,
and the captured parent graph. They do not reacquire matching objects. When one
result is required, `-ExactlyOne` makes both zero matches and multiple matches
visible instead of silently taking the first.

## Matching has explicit semantics

Criteria field names accept the documented wire names and native-property
aliases. Keys are case-insensitive, but supplying two aliases for the same field
is an error. Entries in one map combine with AND. A bare field value means
equality; an operator map describes another comparison.

String comparisons are ordinal and case-sensitive by default, unlike many
PowerShell operators. Choose a documented case-insensitive operator deliberately.
Numeric criteria require the accepted integer types; they do not coerce arbitrary
strings. An omitted condition differs from a condition whose value is null.

Relationship predicates operate on captured relationships. If the query needs
panes, capture to that depth first. An unavailable relationship raises an error
rather than making an [`Every`](../../guides/query/#match-captured-relationships)
or [`None`](../../guides/query/#match-captured-relationships) condition accidentally true.

## Inspect before dispatching

`Get-TmuxQueryPlan` reports pushed and residual predicates, fields, required
depth, and fallback reasons without contacting tmux. Supply the intended daemon
version when inspecting a version-dependent plan.

`Invoke-TmuxQuery` performs the new acquisition. `-AsResult` retains its complete
captured graph even when the selected collection is empty. A plan can reduce
work; it does not turn a multi-command read into an atomic snapshot.

The [query guide](../../guides/query/) owns the operator catalog, query JSON,
relationship criteria, and pushdown modes. Run
[create windows and panes](../../examples/create-layout/) for a complete program
using exact local selection after one snapshot.
