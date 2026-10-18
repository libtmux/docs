# Sphinx inventories

The assembly publishes `objects-full.inv` and `targets.json` at the default
locale root. Each built port/version publishes `objects.inv` and `targets.json`
at its own root. Existing reference inventories retain their mapping bases.
The [reader guide](../site/src/content/docs/intersphinx.md) shows consumer setup.

## Target ownership

`BaseLayout` declares a page's scope, product, version, source, and logical
document identity. Every owned page exports a document; its rendered `main`
element supplies fragment targets when present.
It exports documents and actual fragment destinations, including headings,
tables, examples, parameter lists, and nested protocol schemas. Demo pages,
search, redirects, and translation placeholders have no exported ownership.
Native Sphinx pages receive the same metadata through `NativeShell`.
Copies of site-wide pages inside port builds remain owned by the shared tree
and are excluded from those copies' inventories.

Specialized renderers attach `data-inventory-id`, `data-inventory-category`,
and `data-inventory-display` to their existing anchor elements. Native aliases
use `data-inventory-native`, a JSON array of `{ type, name }` records. `type`
is an inventory object type: a C++ struct exports `cpp:class`, and a variable
exports `cpp:member`. An unknown language or protocol uses the portable label.
Repeated member presentations set `data-inventory-ignore`; their own pages
publish the canonical API targets.
Generated dialogs and other controls are excluded. API sections inherit their
declaration identity, so changing a page slug does not rename its examples or
parameter sections. Named C enumerators use file and spelling rather than
Doxygen's anonymous-enum hash. Unnamed declarations retain producer identities
and need explicit aliases when those identities change.
Signatures use native method identities when supplied, otherwise a hash of
normalized native syntax or structured parameter semantics. Native syntax
keeps qualifiers and companion declarations distinct even when shared fields
omit them. Layout whitespace does not change these keys.

The record contract lives in `packages/api-model/src/targets.ts`. Logical
identity, display, final URL, version, and provenance are separate fields.
The serializer does not derive page slugs. Portable keys escape bytes outside
lowercase ASCII letters, digits, and `-._~`, preserving case through `std:ref`.
Native aliases include scope and product; shorter names are emitted only
when they have one destination.

## Authored targets

Set `inventoryId` in document frontmatter to preserve a document's identity
when its source or route moves. Preserve explicit HTML heading IDs when their
wording changes. Automatically generated IDs remain dependent on that wording.

Tables can declare semantic types by their section ID:

```yaml
inventoryTables:
  root-keys:
    type: std:confval
    identity: schema/session
    prefix: session.
```

The row-anchor plugin exports each name in the first cell at the row's real
fragment. Supported types are `std:confval`, `std:cmdoption`, `std:envvar`, and
`std:term`. Type only tables that document those entities. Generic table rows
retain portable labels independently of this adapter.

## Migrations

Keep a retired portable key in `site/src/data/inventory-aliases.json`:

```json
[
  {
    "scope": "rs",
    "from": "rs:core:heading:guide%23old-heading",
    "to": "rs:core:heading:guide%23current-heading",
    "fragment": "old-heading"
  }
]
```

`from` resolves to the current destination. Optional `fragment` also preserves
the retired HTML ID on that page; conflicting IDs and missing destinations
fail assembly. Use content `aliases` for retired page routes. Document
`inventoryAliases` adds historical portable keys for the document itself.
Explicitly review removed identities rather than generating aliases from
new display text.

Compatibility exports preserve prior raw API names. The root compatibility
inventory also retains historical Python-type aliases from the old aggregate;
new inventories use the correct domains. Historical case-sensitive raw labels
remain limited by `std:ref` normalization. New consumers use portable keys.

## Verification

Port builds compare exported API identities with the selected model. Assembly
selects the manifest's default version for the full export and records excluded
ports in `targets.json`. Inventory generation fails on conflicting identities,
duplicate anchors, unsupported built-in types, and escaping mapping bases.

The publication audit uses `scripts/check-inventories.py` to compare catalogs
with Sphinx's inventory reader, check every emitted destination and decoded
fragment, and build strict reStructuredText and MyST consumers over HTTP.
Plain Sphinx loads only `sphinx.ext.intersphinx`; no custom domain is required.
Focused contract tests remain in the ordinary unit suites.

## Publication order

Root publication merges the successfully published port manifests before
composing its aggregate. `compose-published-inventory.mjs` uses the local
catalog for a shell-owned default tree. For independently published trees or
versions absent from the shell artifact, it reads the selected version's
published catalog from the bucket. The aggregate records each catalog's hash.
This prevents a locally built `latest` tree from replacing the inventory of
a published `stable` default.

Publish updated port artifacts, including their root `objects.inv` and
`targets.json`, before the first root publication. A missing catalog fails
composition before the footer or aggregate is uploaded. The root publisher
does not manufacture another version's destinations from the current model.
