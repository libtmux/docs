# Where the reference differs from gp-sphinx, and why

The eight-port reference at `/reference/` is meant to be visually
indistinguishable from gp-sphinx's rendering. It is not identical *code*, and
this is the list of every place it deliberately diverges. An unrecorded
difference is a defect; this file is what makes that statement checkable.

Three checks hold the claim up, and all three run in `pnpm test`:

| Check | What it asserts |
|---|---|
| `site/scripts/check-style-parity.mjs` | Computed styles match gp-sphinx's for the same element, on the one page both pipelines render |
| `site/scripts/check-visual.mjs` | This site does not change appearance by accident — 30 committed baselines, 3 viewports, both themes |
| `scripts/check-api-fidelity.mjs` | Every entry in all eight ports carries a permalink, a source link, the data hooks and both layouts |

## What is shared

The stylesheet. `site/src/styles/vendor/gp-sphinx-api.css` is
`sphinx-autodoc-api-style`'s `api_style.css` plus the card-level rules of
`sphinx-ux-autodoc-layout`'s `layout.css`, taken verbatim. MIT, team git-pull,
the same owner as this repository. A second stylesheet written to look like
the first is a copy that drifts on the first change to either.

That choice is why entries are `dl.py` / `dt.sig` / `dd`. The brief left the
structure open, and this is the structure those rules match — also the one
docutils chose, because a reference entry *is* a definition list.

## One reference per port

Every port's `/<slug>/<version>/api/` redirects to `/reference/<slug>/`, and
Python is the only exception.

Five ports used to answer "the API" twice, in three different visual systems:
Sphinx+Breathe for C++, DocC for Swift, staged Markdown for TypeScript and
.NET, and this site's own components at `/reference/`. A reader arriving at
`/cxx/stable/api/` met a page with no cards, no badges, no source links and no
prose at all, while `/reference/cxx/` had all four. Whatever else parity means,
it cannot mean two answers.

Python keeps its generated tree because `/py/stable/api/` is not a duplicate:
it is gp-sphinx rendering upstream's own documentation, which is a different
document from this site's extracted reference, and it is the oracle
`check-style-parity.mjs` measures against. Deleting it would delete the
measurement.

The redirect is a page rather than a 301 — a static site has no server to
answer with one — carrying a meta refresh, a canonical link, `noindex`, and a
visible link for anyone whose browser refuses the refresh. Deep links below
`/api/` do not survive; only the entry does.

Cost: 4,118 pages to 1,872, and ten reference generator runs to two.

## Deliberate divergences

**Members are siblings, not children.** gp-sphinx nests a class's methods
inside its `<dd>`, and gets the lighter treatment for them from that nesting.
This site renders them as siblings of the class and applies
`gp-sphinx-api-container--member` instead. Same picture — the parity check
compares the computed result — without burying 98 entries inside one
description, which keeps the page a flat list the sidebar can index and a
reader can scan.

**The contents column is a disclosure below 64rem.** gp-sphinx is a Furo site
with Furo's mobile drawer. This site had neither, so `Server`'s 98 members and
60 types rendered as a block above the content: two screens of links before a
phone reader reached the first entry. It is a `<details>` now, open by default
so it behaves without JavaScript.

**No fold, no signature-collapse.** gp-sphinx emits `data-has-fold` and
`data-signature-expanded` and ships JavaScript that acts on them. The hooks
are emitted here with honest values — both `false` — because the CSS reads
them, but nothing folds. A long signature wraps instead. This is a gap, not a
decision, and the honest values are what will let it be closed without
touching the markup.

**Domains are mapped, not claimed.** `data-domain` is `py` for Python, `cpp`
for C++ and `js` for TypeScript, because those Sphinx domains exist and mean
that. The other five ports have no Sphinx domain, so they get `std`, which is
what Sphinx itself uses for a thing it has no domain for. Calling a Rust trait
`py:class` would be a lie a consumer could act on.

**Prose rendering covers paragraphs, nested lists and headings.** gp-sphinx
has docutils and therefore handles tables, admonitions, definition lists and
the rest. Anything else renders as a paragraph. Half-handling a table is worse
than not claiming to.

**Cross-references are parsed per language, and the set is closed.** Each port
gets the syntaxes it actually writes — reST roles for Python, `[Path::x]` for
Rust, `[Name]` for Go, `{@link}` for Java and TypeScript, `<see cref>` for
.NET, ``` ``Symbol`` ``` for Swift. Anything outside that table is prose. The
per-language table is in `packages/api-model/src/doc/roles.ts`; adding a
syntax means adding a matcher, not widening an existing one, because the
guards are what keep `[see below]` from becoming a link.

**The page shell is this site's, not Furo's.** Header, footer, search, version
switcher and port switcher are shared with the rest of libtmux.org. Only the
reference *content* is held to parity. Under reduced motion the API surface
matches — transitions on the entry header are `0s` on both — while the shell
animates less than Furo's, which is a difference in the site's favour rather
than a gap.

**Coverage is a superset.** 98 members against gp-sphinx's 94 for
`libtmux.Server`, with nothing missing in either direction: the four extra are
`__enter__`, `__eq__`, `__exit__` and `__repr__`, which this extractor keeps
and autodoc's default configuration drops.

Source links: 198 across 99 entries — the 98 members and the class — against
gp-sphinx's 152. Two of the difference is that each entry renders both layout
variants and the container query shows one; the rest is that inherited members
get a source link here, pointing at the class that declares them.

**Source links resolve to a commit, not a tag or a branch.** gp-sphinx builds
them with `sphinx.ext.linkcode` and `make_linkcode_resolve`, which picks
`blob/v{version}` for a release and falls back to `blob/{source_branch}` —
`main` by default — whenever the package version contains `dev`. So a
development build of libtmux's own docs links to a moving branch, and the line
it names drifts away from the page as soon as anyone commits.

This site records `merge-base HEAD origin/HEAD`: an immutable sha, and
specifically the newest one a reader can open. That choice is forced rather
than preferred. Several ports are extracted from a `-docs` worktree whose head
exists only on a private fork, so `HEAD` would 404 and a branch name would go
stale; a merge-base is the only ref that is both public and pinned. The cost
is that a link can point into history — if the extracted commit is ten commits
ahead, the reader sees the file ten commits ago. `check-source-links.mjs`
asserts the sha is reachable from a non-private remote.

**Line numbers are syntactic, not introspected.** gp-sphinx calls
`inspect.getsourcelines` on the imported object, which means it imports the
package to document it, and it is Python-only for that reason. This site reads
positions out of the extractor — tree-sitter, Doxygen XML or a Swift symbol
graph — so nothing is imported, the same mechanism serves eight languages, and
a port that will not build still documents.

Where the two disagree is the commit a line belongs to. gp-sphinx's line is
whatever it introspected at build time and the ref is a branch, so they always
agree by construction. Ours are separated: the line comes from the extracted
commit and the ref names an older one. Lines are therefore remapped through
`git diff -U0` (see `packages/api-model/src/source-lines.ts`), and 99 Python
links would otherwise have pointed a reader at the wrong line silently. Four
symbols sit inside ranges the two commits disagree about and carry no line at
all — those links open the file rather than a line, which is the one place
this site deliberately gives less than gp-sphinx.

**Repeated names in the contents carry their module.** gp-sphinx renders a
name and nothing else, because a Sphinx page is one module and a name is
unique within it. This site lists a port's whole type set in one contents
column, where `Error` occurs three times in Rust and `Server` five. Repeats —
and only repeats — get a muted module suffix; qualifying all 553 Rust entries
would bury the name being scanned for under the path that is not.

**Preload fonts used on initial pages.** The shared layout preloads nine
faces measured by `scripts/check-fonts.mjs`, sets `font-display: block`, and
waits for `document.fonts.ready` before revealing the page. Other faces remain
available through CSS and load when needed.

The visibility gate prevents a fallback font from appearing while Plex loads.
Astro's `optimizedFallbacks` provides a metric-matched family backed by
`local("Courier New")` with `font-display: swap`. That fallback can paint even
while Plex Mono is in its block period. In the original delayed-font test,
the wordmark painted in Courier at 300ms and changed when Plex arrived.

Preloading starts font requests alongside critical CSS. Loading every face at
that priority competes with the fonts the initial page needs. The gate waits
for every face the document uses, including faces outside the preload list.

The current browser check observes these faces:

| Face | Example pages that use it initially |
|---|---|
| Sans 400 | All sampled page types |
| Sans 500 | Traversal topic, attach-and-send-keys example |
| Sans 600 | Home and most sampled page types |
| Sans 700 | Symbol index, topics, examples, member references |
| Mono 400 | Home, reference entries, examples |
| Mono 400 italic | Python and .NET member references |
| Mono 600 | All sampled page types |
| Mono 700 | Reference entries |
| Mono 700 italic | Reference entries |

The browser check fails when an initial page needs an unpreloaded face or a
preloaded face appears in none of the sampled pages. It covers layout types,
a reference entry for each port, and member references. The native Sphinx
page uses its own preload list and is checked separately.

The delayed-font test holds font responses for 1.2s. On the home page, a
reference entry, a topic, and a Java reference entry, the first visible frame
matches the settled page and CLS is 0.0000.

**`.prose h1` is 700, not the typography plugin's 800.** IBM Plex ships no
800, so an 800 was a weight the browser faked by smearing the Bold, on the
largest text on the page. This is not a divergence from gp-sphinx, whose own
`h1` is 500 — it is a smaller step in the same direction, taken because it
changes the weight without restyling the heading scale.

## Not yet parity

- **No cross-reference tooltips.** Furo shows a preview on hover for internal
  links.
- **`data-has-fold` is always false**, as above.
- **Source links name a line, not a range.** gp-sphinx emits
  `#L85-L120`, so GitHub highlights the whole declaration; this site emits
  `#L85` and highlights one line. The extractors all know where a declaration
  ends — tree-sitter has `endPosition`, Doxygen has `bodyend` — so this is a
  field the model does not carry yet rather than information it lacks.
- **Go, .NET and C++ have almost no examples.** Not a rendering gap. Go puts
  them in `Example` test functions, and extracting those would mean reading
  its test files, which is a different mechanism from everything else here.
  .NET rarely writes them in doc comments. C++ writes none at all: 31 headers,
  zero fences and zero `@code`, so Doxygen emits no `programlisting` for this
  project to read. A C++ page shows the counterpart examples the concept map
  knows about and no tab of its own, which is accurate rather than missing.
  Java's seven were a rendering gap — javadoc fences with `<pre>{@code …}</pre>`,
  and reading that as prose hid them inside a printed tag. Swift's four were
  the same shape: its symbol-graph extractor never parsed the Markdown.
- **Go's indented code blocks are not detected.** Go spells a code block with
  indentation rather than a fence. Three symbols in libtmux-go use one, and
  after comment-marker stripping the block's first line is flush with the
  prose while its continuations are not — so there is no reliable signal.
  They render as paragraphs.
- **Interlinking density still varies by port**, because the corpora do:
  Python 8.3 links per thousand characters of description, Go 3.9, C++ 1.4,
  Rust 1.2, TypeScript 1.1, Swift 0.8, Java 0.8, .NET 0.7. Python's docstrings
  simply carry more cross-references than the others' doc comments do. What is
  no longer true is that any port sits at zero for want of a parser.

## Closed since this file was written

The content measure. gp-sphinx caps at Furo's `46em`, 754px against its
16.4px root; the reference had no cap and ran to 960px — a third wider than
this site's own prose pages at 704. Capped at 47rem, 752px. The style-parity
check gained a width case, having previously compared only colour, spacing and
type: it reported seven treatments matching while the column was a third too
wide.

Cross-references in every language. Inline parsing used to be one reST-shaped
tokenizer for all eight ports while block parsing dispatched properly, so Go,
Java, .NET, Swift and TypeScript rendered every reference as literal text.

Inline emphasis. `**bold**` reached the page as literal asterisks: the
renderer splits into block structure and inline references, and Markdown
emphasis was in neither. No visible docstring had used it until `#[derive]`
stopped hiding `server::Server`'s doc comment. Only the doubled form is
claimed — a single `*` is emphasis, a glob and a multiplication sign at once.

Shiki colour outside gp-sphinx's DOM. The only rule reading `--shiki-light`
and `--shiki-dark` was scoped to `dl.py > dd .highlight`, which the per-symbol
examples sit inside and the cross-port example tabs do not, so every token on
a page showing another port's example rendered in one flat inherited grey.

Javadoc's HTML. A javadoc comment is HTML by specification and was being read
as prose, so 192 `<p>` and 7 `<pre>` printed across 146 pages of the Java
reference. The dialect is now declared on the language spec, beside C#'s, and
translated on the way into the doc model — the source keeps its tags, which
javadoc's own output needs.

C# documentation XML. It was left in place on the reasoning that `<summary>`
and `<param>` are structure a renderer could use — correct, and then no
renderer was written, so 2,034 tags escaped onto the page. Parsing it gave
.NET 1,032 documented parameters, 259 return descriptions and 240 exceptions
where it had none. Javadoc block tags did the same for Java.


Examples are syntax-highlighted. Shiki runs at build time over the 914 blocks
across Python, Rust and TypeScript, emitting both themes as custom properties
so the same markup serves either colour scheme with no flash and no
JavaScript. A block that fails to highlight renders as plain text in the same
card, because an unhighlighted example is a small loss and a build that dies
on an odd docstring is not. It costs about ten seconds of build time.

## Refreshing the vendored CSS

Re-read the two upstream files and re-resolve the eight custom properties
against a built gp-sphinx page in both themes — `site/src/styles/vendor/`
records the procedure. `check-style-parity.mjs` fails when they drift.
