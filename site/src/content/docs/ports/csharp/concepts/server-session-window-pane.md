---
port: csharp
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: How tmux servers, sessions, windows, panes and attached clients relate to each other.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

libtmux models tmux's server, session, window, and pane objects:

```
Server
├── Session
│   └── Window
│       └── Pane
└── Client (attached view)
```

A `Server` contains sessions. Each `Session` contains links to windows, and each
`Window` contains panes. Commands run inside a `Pane`, where you send input and
capture output. A window can be linked to more than one session.

## Stable identity, not name or index

tmux assigns a unique ID to each session, window, and pane at creation. The ID
remains stable for that object's lifetime even if its name or index changes:

| Object | ID prefix | Example |
|--------|-----------|---------|
| Session | `$` | `$13` |
| Window | `@` | `@3243` |
| Pane | `%` | `%5433` |
| Server | - | identified by socket name or path instead |

Use stable IDs to identify the same tmux object across reads. Names and indexes
can change while a program is running.

Read the hierarchy:

```csharp
foreach (Session session in await server.GetSessionsAsync())
{
    Console.WriteLine(session.Name);
    foreach (Window window in await session.GetWindowsAsync())
    {
        Console.WriteLine($"  {window.Index} {window.Name}");
        foreach (Pane pane in await window.GetPanesAsync())
        {
            Console.WriteLine($"    {pane.Index} {pane.Width}x{pane.Height}");
        }
    }
}
```

## Client: a view, not a child

A `Client` represents a terminal attached to a session. Several clients can view
the same server, and each can switch sessions or windows independently. Client
fields describe the view at the time of the read.

A [control-mode connection](../transports/) is also a client. It appears in
`list-clients`, counts toward `session_attached`, and affects
attachment-dependent behavior such as `destroy-unattached`. Closing the last
attached client can therefore destroy a session configured with that option.
