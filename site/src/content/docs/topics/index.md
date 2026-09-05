---
title: Topics
description: Deep dives into one subject at a time, compared across all eight libtmux ports.
sidebar:
  label: Overview
  group: Topics
  order: 1
---

[Concepts](/concepts/) covers the mental model every port shares. This
section goes one level deeper: one subject per page, worked through in
enough of each port's own API to be useful on its own, rather than compared
side by side the way [Concepts](/concepts/) does.

Where a subject reduces to "here's the shared idea, here's how the syntax
differs," it's already covered there —
[control mode vs one-shot](/concepts/transports/),
[filtering and queries](/concepts/queries/), and
[workspaces](/concepts/workspaces/) are all in Concepts, not repeated
here. Topics is for subjects with enough of their own shape — object
identity and internals, moving around the hierarchy, cleanup, driving a
pane, tmux's own configuration surface, the typed fields every object
exposes, waiting on tmux instead of guessing a delay, the two things tmux
calls "environment," naming and checking on a server, and what a failed
command becomes — to earn a page each:

- **[Architecture](architecture/)** — the object hierarchy underneath the
  API you call, how each port lays out its own code, and who actually holds
  the behavior: a method on the object itself, or a call through a single
  `Server`.
- **[Traversal](traversal/)** — moving up and down the
  server/session/window/pane tree from a handle you already hold, and the
  two questions that come up once you have more than one: is this object
  *in* that collection, and are these two handles the *same* object.
- **[Context managers](context-managers/)** — scoping a session, window,
  or pane to a block of code so it's torn down when you leave, whether you
  exit cleanly or an exception unwinds the stack — and the real differences
  in how far each port takes that idea.
- **[Pane interaction](pane-interaction/)** — typing into a pane and
  reading its screen back: the enter-or-not and literal-or-not choices on
  the way in, the range and encoding choices on the way out, and waiting for
  a command to actually finish.
- **[Options and hooks](options-and-hooks/)** — reading and writing the
  knobs that shape tmux's behavior, and binding commands to the events tmux
  fires as things happen, at whichever scope you're holding.
- **[Format-token fields](format-tokens/)** — the typed fields every
  object exposes, mirroring tmux's own `#{...}` format tokens, and why a
  field is sometimes absent: wrong scope for the object, or too new for the
  tmux you're running against.
- **[Waiting and retrying](waiting-and-retry/)** — polling a condition
  instead of guessing a sleep, tmux's own `wait-for` signal channel as the
  alternative to polling, and which of that is test-support versus part of
  the ordinary API in each port.
- **[Environment](environment/)** — the two things tmux calls
  "environment": the OS variables it writes into a pane so code running
  inside it can find its own way back to the server, and tmux's own
  persistent variable store that a new pane inherits.
- **[Socket and servers](socket-and-servers/)** — naming one tmux server
  among several with a default, named, or explicit socket, checking whether
  it's actually there, and telling a live daemon apart from one that
  restarted on the same path.
- **[Errors and exceptions](errors-and-exceptions/)** — what a failed tmux
  command becomes in each port's own idiom, and the question every one of
  them has to answer before letting you retry it: did tmux actually see this
  command or not.

Every page here is written from whichever port has the deepest verified
material for that subject, then checked against the other seven and marked
up where they genuinely diverge. Where a claim about a port couldn't be
verified against that port's own source, the page says so rather than
guessing.
