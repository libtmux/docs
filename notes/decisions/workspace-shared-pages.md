# One workspace page per relative path, filtered per port

Decided 2026-09-19, implemented the same day.

## The problem

`site/src/content/docs/ports/<port>/workspace/` held 37 relative paths common
to all 8 ports, each duplicated 8 times. For a typical page such as
`configuration/environment.md`, two ports differed in roughly 9 of 100 lines:
the frontmatter `port:` value, one heading, a short builder note, and a
source link. The other 91 lines drifted only by accident.

## How it works

`site/src/loaders/workspace-shared.ts` extends
[`notes/decisions/per-language-prose.md`](./per-language-prose.md)'s
"one source, filtered per port" idea from code fences to prose. A shared
source lives under `site/src/content/_workspace-shared/<relpath>`, one file
per relative path. Its frontmatter carries shared defaults plus a
`ports.<slug>` override map; its body carries shared prose plus
`<!-- port:LIST --> ... <!-- /port -->` regions, nestable, that survive only
for a port in `LIST`. A custom content loader reads each shared file and
synthesizes the 8 `ports/<slug>/...` collection entries `docsPath` and
`docsRoutePath` (`site/src/lib/docs-paths.ts`) already expect, so routing,
the sidebar, and the port switcher needed no changes.

Unlike the concept pages `per-language-prose.md` describes, a workspace page
keeps its `/<port>/<version>/` URL prefix in every build, including the
root build — there is no unprefixed `/workspace/index/` route, and one must
not appear. The loader supplies that by tagging every synthesized entry with
`product: 'workspace'` and a real `port`, exactly as the deleted per-port
files did; only the physical source is now shared.

## What stayed separate

32 of the 37 relative paths migrated. 5 did not:
`internals/{topics,index,examples}.md`, `reference.md`, and
`reference/compatibility.md`. Each port's copy of these pages describes that
port's own implementation in enough depth that the ports share almost no
sentences — merging them produced a *longer* combined source than the 8
files it replaced, tagged block by block, harder to read than either the
original duplication or the pages that did shrink. The same rule
`per-language-prose.md` states for concept pages applies here in reverse:
if a page renders almost entirely differently per port, forcing it into one
deduplicated source does not serve the reader who has to write it, or the
one who has to read the tags.

## What this cost

Two filesystem-scanning scripts read `site/src/content/docs` directly
rather than through Astro's collection API, so they could not see the
loader's synthetic entries on their own: `gen-mentions.mjs` (regenerating
the "Discussed in" index) and `check-api-links.mjs`. Both now reconstruct
each shared source's 8 per-port bodies the same way the loader does, and
include them in their normal scan. `gen-example-sources.mjs` and
`check-citations.mjs` needed no equivalent change: none of the 32 migrated
pages carry a `file=`/`region=` fence or a "Where this comes from" citation
table for either script to have missed.

## Verification

A full site build (`--ports go,ts`) before and after the migration produced
an identical route list (6,165 routes) and, for every migrated page across
all 8 ports, page text that differs only in the "Source" footer, which now
names the shared file. Every shared source's body was round-tripped through
the actual resolver for every port and compared byte-for-byte against the
file it replaced.
