---
title: Snapshots, cursors, and references
description: Query Ruby MCP metadata, page a retained result, and use references within the server binding that created them.
port: ruby
product: mcp
sidebar:
  label: Snapshots and references
  group: Topics
  order: 10
---

Use [`tmux_snapshot`](../../tools/tmux_snapshot/) to inspect sessions, windows,
panes, window links, or attached clients. The tool captures metadata and
evaluates the Ruby criteria against that capture. Reading a later page keeps
the original result; starting another query acquires new metadata.

The [client guide](../../guides/connect-client/) provides the complete setup
used below. Its launcher creates a private daemon with one session named
`mcp-example`. These JSON blocks are tool arguments to send through that
connected MCP client.

## Discover the binding and limits

Call [`tmux_capabilities`](../../tools/tmux_capabilities/) with an empty
argument object. Read [`structuredContent.ok`](../../tools/tmux_capabilities/) before using `"data"`.

The successful data identifies the selected endpoint, its server generation,
the enabled tools, the criteria schema, and the current limits. `endpoint` is
the public alias chosen by the launcher; the socket was selected separately
when the MCP process started. Requests cannot choose a different socket.

Use the returned generation and references as opaque identities. The tmux
daemon PID, its start time, and an entity's numeric ID are useful context;
they do not replace the generation when constructing a target.

## Read a session listing

Call `tmux_snapshot` with:

```json
{"entity": "session", "limit": 50}
```

The example returns one item whose `fields.name` is `mcp-example`.
Its result has `truncated: false` and no `next_cursor`; pagination applies
when a selection contains more records than its page limit.
Each item has a `kind`, a `fields` object, and a `ref`. The fields describe
the captured state; the reference identifies an entity for a later operation.
Client records have `ref: null`, because clients are not supported mutation
targets. Window-link references additionally identify the session and index
of that particular link.

The result also includes a `capture_id`, `server_identity`, `"coverage"`, and an
`interval`. Acquisition reads several tmux listings. It reports the start,
finish, and number of reads; it does not claim that all fields were observed
at one instant. A complete acquisition can still be old by the time the client
uses it. Unsupported or incomplete acquisition produces an error rather than
silently presenting a partial listing as complete.

## Filter captured metadata

Include the versioned Ruby criteria object to select the example session:

```json
{
  "entity": "session",
  "criteria": {
    "profile": "libtmux-ruby.where",
    "version": 1,
    "entity": "session",
    "where": {"name": "mcp-example"}
  }
}
```

This also returns one item. A valid criterion that matches nothing returns
an empty `items` array, not a missing-session exception. Filtering happens
locally after acquisition; selecting one session does not turn the operation
into a tmux query that reads only that session.

Use the schema returned by discovery for field names and operators. The wire
format uses names such as `currentCommand` and `startsWith`, which differ from
Ruby method spelling. The criteria entity must match the outer `entity`.
The decoder also bounds bytes, nesting and nodes, rejects duplicate keys, and
rejects floating-point tokens for integer fields. A generic JSON Schema
validator alone does not establish that the Ruby decoder will accept a value.

## Continue the same result

The default page limit is 50 records; the accepted range is 1 through 200.
When a page has `truncated: true`, its `next_cursor` identifies the next
position in that retained result. Send a new `tmux_snapshot` call with only
the `cursor` property set to that returned string. Do not also send `entity`,
`criteria`, or `limit`: a continuation cannot change its query or page size.

Each page retains the same capture identity, acquisition interval, and
selection, even if tmux changes meanwhile. `truncated` describes whether more
records remain in this result. It does not mean that the tool silently
discarded the rest. Follow the cursor until no next page remains.

Captures are retained for 30 seconds by default, within a shared budget of
16 captures and 8 MiB. Screen tracking also uses that retention budget.
New captures can evict older ones before their lifetime expires. A well-formed
cursor with an unknown or expired capture, or a position outside its result,
produces `stale_cursor`. A malformed cursor produces `invalid_input`. Neither
starts a new listing on the client's behalf. Start a new query and keep its
pages separate from any earlier capture when a current result is needed.

The request deadline is five seconds by default and a structured response is
limited to 1 MiB. A smaller page can reduce response size, but it does not
reduce the work or retained bytes required to acquire and filter the complete
metadata capture. Treat a capacity refusal as a failed request.

## Keep references within their binding

Pass an item's returned `ref` to an enabled operation that accepts that entity
kind. Preserve the whole object, including `generation`. Do not reconstruct a
reference from the visible name, attach a generation from another connection,
or assume a reused tmux ID still describes the same entity.

A reference is not a lease on a live pane process. The entity may disappear
after the snapshot; a pane can remain while its program is replaced. Process
observation uses additional retained identity checks where the platform and
tmux version support them. A metadata snapshot alone does not establish that
a process is still running or that a command has completed.

Reconnecting the client guide's launcher creates a new daemon and binding.
Rediscover capabilities and acquire fresh references. Even when an application
keeps its daemon running between MCP connections, a reference from one binding
must not be transplanted into another.

## Read metadata through resources

Clients that support MCP resource templates can discover `tmux_metadata` and
`tmux_metadata_page`. The first acquires a metadata snapshot with the default
page limit; the second reads a retained page. Resource access uses the same
tool policy and response bounds.

Fill the advertised URI template from discovery and the current result,
percent-encoding each component. The endpoint, generation, entity, and cursor
must agree with the retained query. A URI is not a way to bypass the binding
or select another daemon. Resource reads return JSON content containing the
same application result envelope; protocol errors carry the failed operation's
details. The server advertises neither subscriptions nor resource-list change
notifications, so a client must explicitly request a fresh observation.

## Handle errors before reading data

Successful tool responses have `structuredContent.ok: true` and `"data"`.
Application failures set `isError: true` and return `ok: false` with an
`error` object containing a code, message, and delivery evidence. Check this
envelope even when the JSON-RPC request itself completed.

| Error | Reader action |
| --- | --- |
| `invalid_input` | Correct the argument shape, types, page limit, cursor format, or continuation fields. |
| `invalid_filter` | Check the criteria profile, version, fields, and matching entity. |
| `stale_cursor` | Start a fresh query instead of joining pages from different captures. |
| `stale_target` | Rediscover and inspect the entity before deciding whether to retry. |
| `capacity` | Reduce the requested work where possible and inspect the published limits. |
| `deadline`, `transport_error`, `incomplete_snapshot` | Treat the requested observation as unavailable; do not report an empty successful result. |

The pinned [snapshot implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-mcp/lib/libtmux/mcp/application.rb),
[tool schemas](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-mcp/lib/libtmux/mcp/catalog.rb),
and [resource implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-mcp/lib/libtmux/mcp/resources.rb)
define the behavior described here.
