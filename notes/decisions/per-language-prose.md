# One prose source, rendered per language

Decided 2026-09-02, implemented the same day.

## The problem

The site is one shell serving eight ports. Until now every port showed the
same prose: `/cxx/stable/concepts/transports/` was a byte-identical copy of
`/concepts/transports/`, marked `noindex` and canonicalised back to the root
precisely because it carried nothing of its own.

That is not what a reader wants. Someone reading the C++ documentation wants
C++ in the code blocks, and the ability to switch language without losing
their place — which is exactly what Playwright does at `/docs/intro`,
`/python/docs/intro`, `/java/docs/intro`.

## The options

**Duplicate the pages per port.** 24 pages times eight ports is 192 files
that must be edited in lockstep. They would diverge within a week, and the
divergence would be invisible — nothing fails when one copy falls behind.

**Split prose from code into data files.** A page becomes a template plus a
snippet table. Precise, and unpleasant to author: the writer loses the ability
to read the page they are writing.

**One source, per-language fences, filtered at build time.** Chosen.

## How it works

`site/src/plugins/remark-port-code.mjs` maps a fence language to a port slug.
When `LIBTMUX_DOCS_PORT` is set, fences belonging to other ports are removed
from the tree. Languages that name no port — `console`, `json`, `yaml`,
`diff` — are setup or output rather than a sample, so they survive every
build.

The root build sets no port and keeps everything. That makes the root the
cross-language view, and it means an author can read the whole page while
writing it.

Two properties worth keeping:

**It runs as a remark plugin, before Expressive Code.** A dropped fence is
never highlighted or emitted. Hiding it with CSS would leave it in the
Pagefind index, so searching "typescript" would return the Python page.

**A fence may name a file instead of copying one.** `file="examples/x.py"`
is read from that port's checkout at build time, so a snippet cannot drift
from the code its own repository tests. A missing file fails the build,
because a silently empty example is the exact failure this is meant to
prevent.

## The asymmetry, stated deliberately

Self-hosted ports carry prose at a versioned prefix, `/py/stable/concepts/`.
Ecosystem ports carry it unversioned, `/rs/concepts/`.

This looks inconsistent and is intentional. A version segment has to mean
something, and for Rust, Go and Java the only versioned artifact is the
reference — which lives on docs.rs, pkg.go.dev and javadoc.io, each of which
already versions it properly. Inventing `/rs/stable/` here would promise a
versioned tree this site does not build and cannot keep honest.

`portPageUrl()` in `lib/ports.ts` is the single place that knows this. Every
link into another port goes through it.

## What it changed elsewhere

- `Seo.astro`: per-port prose is now distinct content, so it is indexable and
  canonical to itself. The old `noindex` was right only while the copies were
  identical.
- `lib/sidebar.ts`: shared prose belongs to every language build. Matching
  `entry.data.port === port` emptied the sidebar the moment builds set a port.
- Cross-section links must be root-relative, because the same file renders at
  two different depths. `rehype-site-root.mjs` prefixes the deploy root so
  previews under `/pr-123/` still resolve.

## What this costs

Nine indexable variants of each concept page. Playwright carries the same
cost and it is fine there because the code and the reference links genuinely
differ. The rule that keeps it fine here: a per-port page must link into
**that port's** reference, not merely swap its fences. If a page ever renders
identically for two ports, it should not exist twice.
