# API linking: intersphinx, and what to take from it

Written after reading `sphinx/util/inventory.py`, `sphinx/ext/intersphinx/`,
the MyST role usage in `~/work/python/libtmux/docs`, and the Astro + seeded-DB
pattern in `~/work/typescript/hsk-django`. Every format detail below was read
out of the source or out of a real artifact on disk, not recalled.

## Intersphinx is three separable things

Treating it as one feature is why it looks bigger than it is.

**1. A record format.** `objects.inv` v2 is four plaintext header lines
followed by a zlib stream:

```
# Sphinx inventory version 2
# Project: libtmux
# Version: 0.46
# The remainder of this file is compressed using zlib.
```

Then one line per object, `zlib.compressobj(9)`:

```
{fullname} {domain}:{role} {priority} {uri} {dispname}
```

Two space optimisations that the reader reverses and a writer must apply:
an anchor ending in the object's own name is truncated to `$` (Sphinx's own
comment claims 25% off the file), and a `dispname` equal to `fullname`
becomes `-`. The read side is one regex — `(.+?)\s+(\S+)\s+(-?\d+)\s+?(\S*)\s+(.*)`
— which is worth knowing because it means names may contain spaces and the
`uri` may not.

**2. A resolution algorithm.** `_resolve_reference_in_domain_by_target` maps a
*role* to a set of *object types* (`domain.objtypes_for_role`), then tries each
type for an exact, case-sensitive hit. Only `std:label` and `std:term` fall
back to case-insensitive, and a multi-hit there is a warning, not a pick.

That is exactly the shape `packages/api-model/src/link.ts` already implements:
`ROLE_KINDS` is `objtypes_for_role`, and `SymbolIndex.pick()` refuses an
ambiguous match rather than choosing. Arriving at the same design independently
is a reason to trust the borrowed half.

**3. A federation model.** `intersphinx_mapping` is `{name: (base_url, inv_url)}`.
Any site that publishes one file becomes linkable from any other, and the
`:role:`inv_name:target`` syntax says which. No registry, no coordination.

## What we already have, in those terms

| Intersphinx | Ours |
|---|---|
| inventory record | `ApiSymbol` |
| `fullname` | `publicId` |
| `domain:role` | `kind` |
| `uri` | `hrefFor()` |
| `objtypes_for_role` | `ROLE_KINDS` |
| resolver | `SymbolIndex` |

We consume nothing and publish nothing. The four `objects.inv` files in the
tree are Sphinx's own, for `py` and `cxx`, and no part of this site reads them.
Meanwhile `link.ts` carries a hand-written 22-entry table of CPython names —
against the 1,746 entries CPython's real inventory would supply.

## The proposal

### Import: delete the hand-written table

Fetch and cache the inventories we already implicitly depend on — CPython's,
and our own Sphinx-built `py` and `cxx` ones — and resolve against them instead
of `PY_INTERSPHINX`. The 22-entry table becomes a fallback for offline builds,
not the mechanism. This is the cheapest item and it removes a class of silent
gap: `subprocess.Popen` and `dataclasses.dataclass` were both missing from that
table and nothing reported it.

### Export: publish `objects.inv` per port and version

Emit one from `ApiModel` at `/{port}/{version}/objects.inv`, plus one at
`/objects.inv` covering the `/reference/` tree. Three things follow:

- **Our own Sphinx builds can link into the Astro reference.** The Python docs
  are Sphinx; adding libtmux.org to their `intersphinx_mapping` lets a
  docstring write ``:class:`libtmux-rs:Pane` `` and get a working link. That is
  the cross-language linking the site wants, using the mechanism Sphinx already
  ships, rather than a bespoke one.
- **Other projects can link to us**, with no work on our side beyond the file.
- **It is a conformance test.** An inventory that CPython's own reader parses is
  evidence the model's ids and kinds are coherent, checkable in CI.

Mapping `kind` onto a domain role is mostly obvious (`class`→`py:class`,
`method`→`py:method`) and needs a decision for the languages with no Sphinx
domain. `std:label` is the honest home for Rust/Go/Swift symbols; inventing
`rs:struct` would be a domain no reader has.

### Storage: one table, not eight JSON files

`SymbolIndex` builds three maps per port per build, and the site builds
fourteen times — the same model parsed and indexed repeatedly. The DB session's
`node:sqlite` projection is the right shape for this, and `getStaticPaths`
being synchronous is what rules out an async client. The linker should become a
query layer over that store rather than an in-memory index, at which point
"resolve this reference" is one prepared statement and cross-port lookup is
free.

### Cross-language equivalence is still not solved by any of this

Intersphinx federates *projects*; it does not claim two symbols are the same
concept. `:class:`libtmux-rs:Pane`` works because someone wrote `libtmux-rs:`
and `Pane` — the human supplied the mapping. Nothing infers that Python's
`capture_pane` is Rust's `capture`.

Name matching gets the easy cases and fails exactly where the ports diverge,
which is what the comparison tables exist to show. The proposal stands: an
explicit concept map, checkable against both models so it fails loudly. What
intersphinx contributes is the *notation* — `port:symbol` — and the transport.

## Machine-readable outputs

| File | Status |
|---|---|
| `llms.txt` | built, root and per port+version, from resolved content |
| `llms-full.txt` | built, same |
| `docs.json` | **missing** — only Sphinx's own, under `/py/*/api/` |
| `objects.inv` | **missing** — only Sphinx's own, under `/py/*/api/` and `/cxx/*/api/` |

`docs.json` follows `sphinx-gp-llms`'s schema, read from
`_docs_json.py` and from a real 55-page instance in the tree:

```
{ name, url, description, sourceRepository,
  agentEntrypoints: { manifest, llms, llmsFull },
  pages: [ { title, description, section, url, markdownUrl,
             headings: [ { id, level, text } ] } ] }
```

Matching it exactly matters more than designing our own: an agent that already
understands the gp-sphinx manifest then understands ours, and the Python port
publishes both — so the two must agree or the site contradicts itself.

The one field needing thought is `markdownUrl`. gp-sphinx points at a per-page
Markdown twin. We publish none, and the upstream twin generator has the bug
recorded in `10-llms-and-agents.md` (it copies source, not resolved content).
Either omit the field, or emit twins from the same resolved text `llms-full.txt`
already uses — the second is cheap, because that content is already computed.
