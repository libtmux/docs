---
port: ts
route: concepts/queries
title: Filtering and queries
description: Match names, handle missing and ambiguous results, traverse linked windows, refresh snapshots, and validate saved TypeScript queries.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Read a snapshot once, then query its sessions, windows, panes, and clients in
TypeScript. [`Selection.where()`](../../reference/selection-selection-where/)
filters that captured state without another tmux command. Use
[`one()`](../../reference/selection-selection-one/) when the next operation
requires exactly one target.

## Setup and run

These are independent programs with imports, assertions, and cleanup. Each
creates a private tmux server, runs `cat` in its panes to keep them alive, and
stops its server before exiting. They require Bun 1.4.2 or newer, tmux 3.2a
or newer, and a Unix environment. You do not need an existing tmux session.

In an empty directory, save this file as `package.json`:

```json title="package.json"
{"type":"module","dependencies":{"libtmux":"file:./libtmux/packages/libtmux"}}
```

Install the library revision used to run the examples:

```console
$ git clone https://github.com/libtmux/libtmux-ts libtmux &&
  git -C libtmux checkout 3fe1ca654b81b8cbf4a13b777a001a3298c87a6f &&
  bun install
```

Save any program below in that directory and run its command. Each program
includes its own setup; none depends on another example's variables or server.
A failed assertion or cleanup exits with an error. If cleanup fails, the error
names the retained directory so the private server remains reachable.

<a id="typescript-criteria-as-data"></a>

## Match names and combine conditions

A bare value means equality. Matching is case sensitive unless that field's
criterion has `mode: "insensitive"`. Fields in one object and successive
`.where()` calls combine with AND; `AND`, `OR`, and `NOT` compose whole criteria.
`.filter()` accepts a JavaScript predicate when a condition needs application
code, such as membership in an existing `Set`.

| Task | Criterion for `name` |
| --- | --- |
| Equal | `"app-api"` or `{ equals: "app-api" }` |
| Contain text | `{ contains: "api" }` |
| Start or end with text | `{ startsWith: "app-" }`, `{ endsWith: "worker" }` |
| Ignore case | `{ contains: "MYAPP", mode: "insensitive" }` |
| Be in a list | `{ in: ["app-api", "app-worker"] }` |
| Be outside a list | `{ notIn: ["shell"] }` |
| Match a pattern | `{ regex: { pattern: "^app-v[0-9]+-0$", flags: "" } }` |

Save as `matching.ts`. It selects exact names, composes conditions, and compares
structured criteria with a local predicate.

```typescript title="matching.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  const session = await server.newSession({
    name: "work", windowName: "shell", shellCommand: "cat",
  });
  for (const name of ["app-api", "app-worker", "MyApp-logs", "app-v1-0", "app-beta"]) {
    await session.newWindow({ name, shellCommand: "cat" });
  }
  const { windows } = await server.snapshot();
  const exact = windows.where({ name: "app-api" });
  assert.equal(exact.one().name, "app-api");
  console.log("exact:", exact.one().name);

  const worker = windows.where({ name: { startsWith: "app-" } })
    .where({ name: { endsWith: "worker" } });
  assert.equal(worker.one().name, "app-worker");
  console.log("prefix AND suffix:", worker.one().name);

  const apiOrLogs = windows.where({
    OR: [{ name: "app-api" }, { name: { contains: "logs" } }],
    NOT: [{ name: "shell" }],
  }).map((window) => window.name).sort();
  assert.deepEqual(apiOrLogs, ["MyApp-logs", "app-api"]);
  console.log("OR and NOT:", apiOrLogs.join(", "));

  const insensitive = windows.where({
    name: { contains: "MYAPP", mode: "insensitive" },
  });
  assert.equal(insensitive.one().name, "MyApp-logs");
  console.log("case insensitive:", insensitive.one().name);

  const versioned = windows.where({
    name: { regex: { pattern: "^app-v[0-9]+-0$", flags: "" } },
  });
  assert.equal(versioned.one().name, "app-v1-0");
  console.log("regex:", versioned.one().name);

  const selected = windows.where({ name: { in: ["app-api", "app-worker"] } });
  assert.equal(selected.count(), 2);
  assert.equal(selected.where({ name: { notIn: ["app-worker"] } }).one().name, "app-api");
  console.log("membership:", selected.map((window) => window.name).sort().join(", "));

  const namesFromConfig = new Set(["shell", "app-beta"]);
  const local = windows.filter((window) => namesFromConfig.has(window.name));
  assert.equal(local.count(), 2);
  console.log("predicate:", local.map((window) => window.name).sort().join(", "));
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run matching.ts
```

The output identifies `app-api`, `app-worker`, and `MyApp-logs`; the version
pattern selects `app-v1-0`. Membership selects two application windows, while
the predicate selects `app-beta` and `shell`.

### Regular expression limits

Structured regex criteria use a restricted grammar. This revision accepts at
most 512 UTF-16 code units and one repetition operator. A repeated pattern must
start with `^`, cannot repeat a group, and cannot combine repetition with
alternation or multiline mode. It rejects lookarounds, backreferences, and
escapes such as `\d`; use `[0-9]` for digits. Accepted flags are `""`, `"m"`, `"s"`,
and `"ms"`; use the field's `mode: "insensitive"` for case folding.

A syntactically valid JavaScript pattern can therefore raise
[`QueryValidationError`](../../reference/errors-queryvalidationerror/) here.
The saved-query example below checks that rejection. For a trusted pattern
that needs the full JavaScript grammar, use a predicate with a `RegExp`; that
predicate is local code and cannot be encoded as a query document.

<a id="the-cardinality-contract-side-by-side"></a>

## Handle zero, one, and several matches

Choose the result contract before using a target:

| Operation | Zero matches | One match | Several matches |
| --- | --- | --- | --- |
| `.where()` | Empty selection | Selection | Selection |
| `.one()` | `NoMatchError` | Object | `MultipleMatchesError` |
| `.oneOrUndefined()` | `undefined` | Object | `MultipleMatchesError` |
| `.first()` | `undefined` | Object | First object in tmux order |
| `.exists()` | `false` | `true` | `true` |
| `.count()` | `0` | `1` | Match count |

Use `.first()` when any first result is acceptable. It does not establish that
there is only one target. `.oneOrUndefined()` relaxes only the missing case;
it still reports ambiguity.

Save as `single-result.ts`. This handles missing and ambiguous results
separately and rethrows unexpected failures.

```typescript title="single-result.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server, MultipleMatchesError, NoMatchError } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  const session = await server.newSession({
    name: "work", windowName: "editor", shellCommand: "cat",
  });
  await session.newWindow({ name: "logs", shellCommand: "cat" });
  const { windows } = await server.snapshot();
  assert.equal(windows.one({ name: "logs" }).name, "logs");
  assert.equal(windows.oneOrUndefined({ name: "missing" }), undefined);
  assert.equal(windows.exists({ name: "missing" }), false);
  console.log("optional missing:", windows.oneOrUndefined({ name: "missing" }));

  try {
    windows.one({ name: "missing" });
    throw new Error("Expected the missing lookup to fail");
  } catch (error) {
    if (!(error instanceof NoMatchError)) throw error;
    console.log("missing:", error.code);
  }

  for (const lookup of [() => windows.one(), () => windows.oneOrUndefined()]) {
    try {
      lookup();
      throw new Error("Expected the ambiguous lookup to fail");
    } catch (error) {
      if (!(error instanceof MultipleMatchesError)) throw error;
      assert.equal(error.count, 2);
      console.log("ambiguous:", error.code, error.count);
    }
  }
  assert.equal(windows.first()?.name, "editor");
  console.log("first:", windows.first()?.name);
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run single-result.ts
```

The program prints `undefined` for an optional missing window, `NoMatchError`
for a required missing window, and `MultipleMatchesError 2` for both ambiguous
lookups. `first()` returns `editor` because it occupies the first window index.

## Query relations and linked windows

A server-wide window selection contains placements: a window linked into two
sessions appears twice with the same window ID. A pane reached through those
placements also has session context. Add a `session` criterion when the action
needs a particular placement. Use
[`linkedSessions`](../../reference/window-window-linkedsessions/) to inspect
the sessions holding the window.

Collection relations accept `some`, `every`, and `none`. `every` and `none` are
true for an empty collection; combine `some: {}` with `every` when you require
at least one related object. Single-object relations use `is` and `isNot`;
`is: null` matches an absent relation.

Save as `relations.ts`. It links one logs window into a second session, selects
its home placement, and queries sessions and panes through their relations.

```typescript title="relations.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server, MultipleMatchesError } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  const home = await server.newSession({
    name: "home", windowName: "logs", shellCommand: "cat",
  });
  const guest = await server.newSession({
    name: "guest", windowName: "shell", shellCommand: "cat",
  });
  const shared = home.windows.one({ name: "logs" });
  await shared.link({ session: guest });
  const snapshot = await server.snapshot();
  const placements = snapshot.windows.where({ id: shared.id });
  assert.equal(placements.count(), 2);
  console.log("placements:", placements.count());

  try {
    placements.one();
    throw new Error("Expected two placements to be ambiguous");
  } catch (error) {
    if (!(error instanceof MultipleMatchesError)) throw error;
    console.log("same ID:", error.code);
  }
  const atHome = placements.one({ session: { is: { name: "home" } } });
  assert.equal(atHome.session?.name, "home");
  const owners = atHome.linkedSessions.map((session) => session.name).sort();
  assert.deepEqual(owners, ["guest", "home"]);
  console.log("linked sessions:", owners.join(", "));

  const hasLogs = snapshot.sessions.where({ windows: { some: { name: "logs" } } });
  assert.equal(hasLogs.count(), 2);
  const onlyLogs = snapshot.sessions.where({
    windows: { some: {}, every: { name: "logs" } },
  });
  assert.equal(onlyLogs.one().name, "home");
  const noShell = snapshot.sessions.where({ windows: { none: { name: "shell" } } });
  assert.equal(noShell.one().name, "home");
  console.log("some logs:", hasLogs.map((session) => session.name).sort().join(", "));
  console.log("every window is logs:", onlyLogs.one().name);
  console.log("no shell:", noShell.one().name);

  const guestPanes = snapshot.panes.where({ session: { is: { name: "guest" } } });
  assert.equal(guestPanes.count(), 2);
  console.log("panes reached through guest:", guestPanes.count());
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run relations.ts
```

The logs window has two placements and two linked sessions. Both sessions
have some logs window. Only `home` has every window named `logs` and no window
named `shell`. The guest session contains two panes through its two windows.

These relations come from the same snapshot. Traversing them does not refresh
the server. A scalar window mutation such as `rename()` affects that window
in every session that links it; selecting a placement does not create a copy.

## Refresh after a mutation

[`Server.snapshot()`](../../reference/server-server-snapshot/) acquires the
state. Filtering and reading relations use it locally. A handle can issue a
mutation, but its captured fields and earlier selections keep their old values.
Acquire another snapshot to observe the result.

Save as `refresh.ts`. It creates a window after a snapshot, then renames it and
compares old and fresh reads.

```typescript title="refresh.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  const session = await server.newSession({
    name: "work", windowName: "editor", shellCommand: "cat",
  });
  const before = await server.snapshot();
  await session.newWindow({ name: "logs", shellCommand: "cat" });
  assert.equal(before.windows.exists({ name: "logs" }), false);
  console.log("old snapshot sees logs:", before.windows.exists({ name: "logs" }));

  const after = await server.snapshot();
  assert.equal(after.windows.exists({ name: "logs" }), true);
  console.log("fresh snapshot sees logs:", after.windows.exists({ name: "logs" }));
  const logs = after.windows.one({ name: "logs" });
  await logs.rename("archive");
  assert.equal(logs.name, "logs");
  assert.equal(after.windows.one({ id: logs.id }).name, "logs");
  console.log("captured name after rename:", logs.name);
  const renamed = await server.snapshot();
  assert.equal(renamed.windows.one({ id: logs.id }).name, "archive");
  console.log("refreshed name:", renamed.windows.one({ id: logs.id }).name);
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run refresh.ts
```

The old snapshot reports no logs window. The fresh one finds it. After the
rename, the existing handle still reports `logs`; another snapshot reports
`archive` for the same ID.

Prefer one snapshot when several queries should describe the same captured
state. Calling `server.sessions()`, `server.windows()`, and `server.panes()`
separately takes a separate snapshot for each call. A snapshot also cannot
prevent another process from removing a target before a later mutation; handle
that command's error at the mutation boundary.

## Save and validate criteria

[`encodeWhereDocument()`](../../reference/selection-encodewheredocument/)
serializes a versioned query. Parse its JSON and pass the value to
[`decodeWhereDocument()`](../../reference/selection-decodewheredocument/)
before applying it. Check the document's model so session criteria go to the
session selection. Use the encoder and decoder to preserve the wire format;
do not cast unvalidated JSON to a criteria type.

Save as `query-document.ts`. It round-trips a session query, rejects an unknown
field, and catches a regex outside the supported grammar.

```typescript title="query-document.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Server, decodeWhereDocument, encodeWhereDocument, QueryValidationError,
} from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  await server.newSession({ name: "prod-api", shellCommand: "cat" });
  await server.newSession({ name: "dev-api", shellCommand: "cat" });
  const encoded = encodeWhereDocument({
    version: 1, model: "session", where: { name: { startsWith: "prod-" } },
  });
  const document = decodeWhereDocument(JSON.parse(encoded));
  assert.equal(document.model, "session");
  if (document.model !== "session") throw new Error("Expected session criteria");
  const snapshot = await server.snapshot();
  const selected = snapshot.sessions.where(document.where);
  assert.equal(selected.one().name, "prod-api");
  console.log("decoded query:", selected.one().name);
  console.log("wire JSON:", encoded);

  try {
    decodeWhereDocument({ version: 1, model: "session", where: { session_naem: "prod-api" } });
    throw new Error("Expected an unknown field to fail validation");
  } catch (error) {
    if (!(error instanceof QueryValidationError)) throw error;
    assert.equal(error.reason, "invalid-query");
    console.log("invalid document:", error.code, error.reason);
  }
  try {
    snapshot.sessions.where({
      name: { regex: { pattern: "^prod-[a-z]+-[0-9]+$", flags: "" } },
    });
    throw new Error("Expected multiple repetitions to fail validation");
  } catch (error) {
    if (!(error instanceof QueryValidationError)) throw error;
    console.log("unsupported regex:", error.code);
  }
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run query-document.ts
```

The decoded query selects `prod-api`. Both invalid inputs raise
`QueryValidationError`. Its `reason` distinguishes invalid IDs from invalid
criteria; `path` identifies the failing field or nested condition.

A valid criterion can still name a field introduced after the running tmux
version. That raises [`VersionTooLowError`](../../reference/errors-versiontoolowerror/),
which carries `criteriaName`, `serverVersion`, and `since`. Treat a version
error as an unsupported query, not as evidence that no objects match.

## Filter a live tmux listing

Use snapshot selections when you need typed handles, relations, several local
queries, or JavaScript predicates. To request only matching rows from tmux,
call `Server.cmd()` with a list command's `-f` option. This returns output lines;
it does not return a `Selection` or apply the TypeScript criteria grammar.

Save as `tmux-filter.ts`. It lists production sessions with a tmux glob, then
shows why an unknown format token can look like a valid empty result.

```typescript title="tmux-filter.ts"
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "libtmux";

const directory = await mkdtemp(join(tmpdir(), "libtmux-query-"));
const server = new Server({
  socketPath: join(directory, "tmux.sock"), configFile: "/dev/null", timeoutMs: 5_000,
});
const failures: unknown[] = [];
try {
  await server.newSession({ name: "prod-api", shellCommand: "cat" });
  await server.newSession({ name: "dev-api", shellCommand: "cat" });
  const expression = "#{m:prod-*,#{session_name}}";
  const names = await server.cmd("list-sessions", [
    "-f", expression, "-F", "#{session_name}",
  ]);
  assert.deepEqual(names, ["prod-api"]);
  console.log("tmux matches:", names.join(", "));

  const unknown = "#{session_naem}";
  const empty = await server.cmd("list-sessions", [
    "-f", unknown, "-F", "#{session_name}",
  ]);
  assert.deepEqual(empty, []);
  console.log("unknown token matches:", empty.length);

  const expansion = await server.cmd("display-message", [
    "-p", "-t", "=prod-api:", expression,
  ]);
  assert.deepEqual(expansion, ["1"]);
  const badExpansion = await server.cmd("display-message", [
    "-p", "-t", "=prod-api:", `value=<${unknown}>`,
  ]);
  assert.deepEqual(badExpansion, ["value=<>"]);
  console.log("valid expression:", expansion[0]);
  console.log("unknown token:", badExpansion[0]);
} catch (error) {
  failures.push(error);
} finally {
  try {
    if ((await readdir(directory)).includes("tmux.sock")) await server.kill();
    await rm(directory, { recursive: true });
  } catch (error) {
    failures.push(new Error(`Cleanup failed; inspect ${directory}`, { cause: error }));
  }
}
if (failures.length > 0) throw new AggregateError(failures, "Query example failed");
```

```console
$ bun run tmux-filter.ts
```

The glob returns `prod-api`. The misspelled `session_naem` returns zero rows
without a command error. Expanding the valid expression prints `1`; expanding
the unknown token between delimiters prints `value=<>`.

When a live filter unexpectedly returns nothing, first run the same listing
without `-f` to confirm the objects exist. Expand the expression with
`display-message -p` against a known target, and check its token names against
the running tmux version's manual. Keep each command argument separate as above;
these strings go to tmux without shell interpolation.

## API and related tasks

- [`Selection`](../../reference/selection-selection/) defines iteration,
  criteria, predicates, counts, and exactly-one lookup.
- [`Server`](../../reference/server-server/) owns snapshot acquisition and
  command execution.
- [Traversal](/topics/traversal/) explains object relationships and identity.
- [Sending keys](/guides/sending-keys/) uses a selected pane as an input target.
- [Capturing output](/guides/capturing-output/) reads a selected pane's screen.
