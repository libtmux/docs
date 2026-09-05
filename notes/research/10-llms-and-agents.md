# Machine-readable docs: llms.txt, Markdown twins, and MCP

`sphinx-gp-llms` already generates `llms.txt`, `llms-full.txt`, `docs.json` and per-page
Markdown twins for the Python docs, and every libtmux port already ships an MCP server —
so the work here is fixing a real bug in what exists, generalizing its one correct rule
to the other seven generators, and deciding what (little) is new: a shared post-build
aggregator, an optional CloudFront rewrite that needs a ledger-owner ruling before it
extends past its current scope, and no ninth MCP server.

## The bug: Markdown twins copy source, not the resolved page

`sphinx-gp-llms` (`~/work/python/gp-sphinx/packages/sphinx-gp-llms/src/sphinx_gp_llms/`)
hooks `build-finished` and writes four outputs: `llms.txt` (a toctree-grouped index),
`llms-full.txt` (full-content concatenation), `docs.json` (a Lakebed-style agent
manifest), and a `.md` sibling per HTML page. `llms.txt` and `docs.json` are built
correctly — both read `app.env.titles`/`app.env.tocs`, Sphinx's resolved model, not
source text.

`_md_twins.py` and `_llms_full_txt.py` are not. `write_md_twins()` does
`shutil.copy2(source_path, target)`; `write_llms_full_txt()` does
`source_path.read_text(encoding="utf-8")`. Both take
`source_path = pathlib.Path(app.env.doc2path(docname))` — the on-disk RST/MyST file —
and copy or read it verbatim. For hand-written prose that's harmless: source *is*
content. For an autodoc page it is not — `.. autoclass::` is resolved by Sphinx at build
time from the object's docstrings and signatures, and the directive itself carries none
of that.

Verified directly, not from a changelog. `~/work/python/libtmux/docs/api/libtmux.pane.md`
— the reference page for `Pane`, one of the four core classes and exactly the page an
agent asking "how do I send keys to a pane" would want — is 19 lines, ending in:

````markdown
```{eval-rst}
.. autoclass:: libtmux.Pane
    :members:
    :inherited-members:
    :private-members:
    :show-inheritance:
    :member-order: bysource
```
````

That is the entire source: no docstrings, no signatures, no members. I ran the real
Sphinx build checked into `~/work/python/libtmux/docs/_build/` and confirmed the bug
end to end:

| Artifact | Lines | Content |
|---|---|---|
| `docs/_build/api/libtmux.pane/index.html` | 4,894 | Fully resolved: 253 `id="libtmux.Pane.*"` anchors, one per method/attribute, each with its docstring |
| `docs/_build/api/libtmux.pane.md` (the "twin", sibling to that directory) | 19 | The unresolved `autoclass` directive above |
| `docs/_build/llms-full.txt`, `# Panes` section | same 19 lines | `shutil.copy2` and `read_text` both pull from `source_path`, so the full-content file has the identical stub |

An agent fetching `/api/libtmux.pane.md` or the `# Panes` block of `llms-full.txt` gets
none of the resolved API content the HTML page next to it has — silently defeating the
purpose of shipping Markdown twins for exactly the pages agents most want. The same stub
pattern hits every other autoclass'd class (`Server`, `Session`, `Window`) and MyST
inline roles like `` {class}`~libtmux.Server` `` (in `docs/project/public-api.md`), which
also pass through unresolved.

**The fix.** `_docs_json.py`'s `_extract_headings()` already shows the right pattern in
the same package: it walks `app.env.tocs[docname]`, Sphinx's resolved ToC tree, instead
of touching `source_path`. `_md_twins.py` and `_llms_full_txt.py` need the same
discipline for body content — a Markdown-writer builder run at `build-finished`
(a `MarkdownTranslator` walking `app.env.get_doctree(docname)` is the same shape of code
as any Sphinx builder), or more simply a second `sphinx-build -b markdown` pass whose
output the two functions read instead of `app.env.doc2path()`. Either way: **read from
the resolved doctree, never the source path** — both functions already iterate
`app.env.found_docs` with `docname` in hand, so only the content-fetch line changes. Fix
it here first: this is the reference implementation every other port's parity is
measured against.

## The same rule, generalized to all eight generators

None of the other seven ports run `sphinx-gp-llms`, so none inherits this bug by import —
but each faces the identical fork: emit machine-readable output from the *resolved* API
model, or from raw doc-comment source. The resolved model already exists in every case,
because it is what the HTML renderer consumes:

| Language | Resolved model to render from, instead of doc-comment source |
|---|---|
| Python, C++ | Sphinx's post-autodoc/post-Breathe doctree (`app.env.get_doctree`) |
| TypeScript | api-extractor's `index.api.json` (the parsed `.d.ts` model, ledger §2.1) |
| Rust | rustdoc's own rendered HTML — already the resolved model in this architecture |
| .NET | `docfx metadata` YAML (the resolved member model DocFX's own templates render) |
| Go | doc2go's parsed AST plus resolved doc comments (the same input `-embed` renders from) |
| Java + Kotlin | Dokka's GFM plugin output (`dokka-subprojects/plugin-gfm`) — already resolved Markdown |
| Swift | DocC's render JSON (the same `data/**/*.json` archive that drives the static HTML, §2.2) |

Rust needs a caveat, not a tool name. `cargo doc --output-format json` looks like the
natural fit, but `21-verification-ledger.md`'s rustdoc item found it stays gated behind
`-Zunstable-options` on every 2026 stable toolchain, with its format version churning
four times in six weeks (57→61) — exactly why the ledger skins rustdoc's own stable HTML
rather than building a custom JSON renderer for the page itself. `rustdoc-md`-style
converters inherit that nightly dependency and are stale (`~/study/rust/rustdoc-md` is
five `rustdoc-types` versions behind, untouched since October 2025). The consistent move:
convert rustdoc's *own rendered HTML* — already the resolved output the skinned page
serves — to Markdown at build time, a one-shot pass analogous to the
`cloudfront-markdown-for-llms` reference repo's `turndown` Lambda, just triggered at
build time instead of on S3 upload events. Dokka's GFM plugin needs no such workaround,
already emitting resolved Markdown; that lane just routes existing output into the
manifest. TypeScript, .NET, Go and Swift need a small renderer each regardless, since
those are the languages whose HTML page is hand-built (ledger §2.1, §1); renderer and
Astro page component share one typed model.

## One shared intermediate manifest, one aggregator

Do not port `sphinx-gp-llms` seven times. Define one small JSON-serializable page record
— `title`, `description`, `url`, `markdownBody`, `headings[]`, `section`, `lang`,
`version` — that every generator's adapter produces in whatever shape is natural for
that toolchain (a build script, a Sphinx extension, an Astro content-loader).
`markdownBody` is the resolved content: the whole point of this document is that this
field must never be a copy of source. One shared aggregator, run once after all eight
languages' builds have landed, reads every page-manifest file and writes:

| Output | Scope |
|---|---|
| `llms.txt` | Root hub plus per-language, per-version files (`/py/stable/llms.txt`), grouped by section as `_llms_txt.py` already does correctly |
| `llms-full.txt` | Full `markdownBody` concatenated under `# Title`/`Source: <url>`/`---`, once the bug above is fixed |
| `llms-small.txt` | A filtered variant demoting/dropping low-priority pages — `delucis/starlight-llms-txt` (MIT, cloned to `~/study/typescript/starlight-llms-txt`) already implements this shape via `promote`/`demote` globs against Starlight's *resolved* collection; port the idea, not the dependency |
| `docs.json` | Merges eight per-build Lakebed-style manifests `_docs_json.py` already emits into one `agentEntrypoints` + `pages[]` tree |
| Sitemap index | See below |

### Running it as an Astro integration

Because the shell is an owned Astro site, the aggregator needs no separate CI step or
cron job: it can be an Astro integration hooked to `astro:build:done`, the same
lifecycle hook `social-embed`'s Pagefind integration already uses
(`~/work/typescript/social-embed/packages/site/plugins/astro-pagefind-integration.ts`) —
called once with the built output directory after the shell's own build finishes.

This covers only the shell's build — one among nine, the shell plus eight per-language
builds owned by eight separate CI pipelines (ledger §7.7). The realistic sequencing:
each language's CI writes its page-manifest JSON to the bucket alongside its build —
cheap, a byproduct of the render step each generator already runs — and the shell's
build, deployed last, fetches the current manifest set at `astro:build:done` and
aggregates. This keeps ledger §6's rule intact (each repo owns an exclusive manifest
key): no repo writes to another's output, and the aggregator only reads.

## llms.txt in 2026: ship it as agent UX, not as SEO

The spec (`llmstxt.org`, Jeremy Howard/Answer.AI, September 2024) is still an unversioned
community convention two years on — no W3C/IETF track, no conformance test, no
governance body. Per the research pass's web sources (not re-fetched for this document):
treat any claim that it improves search ranking or AI-answer citation as false — Google's
Gary Illyes said in July 2025 that Google does not support it and will not, and Google's
AI-optimization guidance (updated June 2026) states sites do not need new
machine-readable files for this. Ahrefs' May 2026 crawl of 137,000 sites carrying
`llms.txt` found 97% got no measurable crawler traffic to the file; SE Ranking's
citation-rate study across roughly 300,000 domains found no statistically significant
correlation with having one.

What it is good for is different and real: eliminating agent 404s, and giving IDE agents
(Cursor, Continue, Cline) and MCP-adjacent tools a page they fetch opportunistically
before crawling HTML — Mintlify's own benchmark across 2,400 runs found a single
`llms.txt` link removes most of that failure mode at negligible cost. Ship the family as
agent UX, not an SEO or citation lever — the audience is coding agents and their tool
wrappers, not search engines.

## The Markdown-alongside-HTML pattern, and where content negotiation fits

Two patterns coexist in 2026 production sites (per the research pass's web sources, not
re-fetched here). Cloudflare's "Markdown for Agents" (a zone-level feature shipped
February 2026) does true content negotiation at the edge: `Accept: text/markdown` on the
same URL triggers on-the-fly HTML-to-Markdown conversion, no separate path. Stripe,
Anthropic and Mintlify instead ship the simpler, older pattern — a static `.md` sibling
at the same path (`/page.html` → `/page.md`), no negotiation, no runtime conversion. For
a static S3 + CloudFront site with no compute origin, the sibling-file pattern is the
only one available without adding compute — and it is exactly what `_md_twins.py`
already produces for Python, once fixed, and what the plan above asks every generator's
build to produce. libtmux.org is aligned by default with the pattern its own tooling
already implements.

**Content negotiation from CloudFront is achievable without a compute origin**, via a
CloudFront Function rather than Lambda@Edge — but it is optional; the sibling-file
pattern above already needs zero CloudFront changes. A working reference for negotiation
exists in `sh-cloud-software/cloudfront-markdown-for-llms` (MIT), cloned to
`~/study/docs/cloudfront-markdown-for-llms`: a `JS_2_0` Function on `viewer-request`
rewrites the URI when `Accept` contains `text/markdown` (`/about.html` → `/about.md`, `/`
→ `/index.md`) and drops the demo's Lambda half, which runs `turndown` (MIT) against
already-rendered HTML only because that demo has no build-time source of truth.

Adopting it means squaring two things with this architecture, not copying it verbatim.
First, ledger §2.3 reserves the CloudFront Function for the bare-language-root redirect
and directory-index handling, explicitly "never to rewrite an already-qualified URL to
different bytes" — the alias-dedup problem `/stable/` vs a version tag creates. An
`Accept`-driven rewrite of `/py/stable/api/libtmux.pane/` is a different case (content
negotiation on one representation, not two competing canonical URLs for the same one),
but it does extend the Function's remit beyond what §2.3 currently authorizes; that
extension is a call for the ledger owner, not a default. Second, the reference Function's
"no extension" branch assumes a directory holds an `index.html` and appends
`index` + the target extension — but Sphinx's dirhtml output pairs `api/libtmux.pane/`
(a directory) with a *sibling* file `api/libtmux.pane.md`, confirmed in the checked-in
build, not `api/libtmux.pane/index.md`. Reusing the Function requires changing that
branch to strip the trailing slash and append the target extension directly, matching
the sibling-file convention `_md_twins.py` already writes, rather than assuming an
index file inside the directory. Its cache-key choice is also worth avoiding on adoption:
it keys the cache policy on the raw `Accept` header, fragmenting the cache across every
distinct header string clients send; normalize inside the Function to a synthetic
single-value header (`x-md: 1`/`0`) and key the cache policy on that instead.

**The missing piece today is discovery, not delivery.** `gp-furo-theme`'s `page.html`
renders a visible footer link to the `.md` twin but has no
`<link rel="alternate" type="text/markdown" href="...">` in `<head>` — confirmed by
reading the template; there is no `rel="alternate"` anywhere in the theme. An agent
landing on the HTML page via search or a shared link has to guess the `.md` suffix
instead of reading it off the page. Add the `<link>` tag alongside the doctree fix.

## Is a docs-serving MCP server worth building? No.

Every port already ships an MCP server, but it solves a different problem than a docs
server would. Confirmed present in each repo:

| Language | Path |
|---|---|
| TypeScript | `libtmux-ts/packages/mcp` |
| Rust | `libtmux-rs/crates/tmux-mcp` |
| Go | `libtmux-go/mcp` |
| Java | `libtmux-java/libtmux-mcp` |
| .NET | `libtmux-dotnet/src/LibTmux.Mcp` |
| C++ | `libtmux-cxx/apps/mcp` |
| Swift | `libtmux-swift/Sources/LibTmuxMCP` |
| Python | sibling repo `libtmux/libtmux-mcp` |

Go's `PARITY.md` notes its server is *not* a port of Python's, and vice versa. All eight
are runtime-control servers: tools drive a live tmux process (`send_keys`, `capture_pane`,
resource subscriptions).

A docs-serving MCP server would be a ninth, structurally different kind per language —
static content retrieval with no live-process dependency, functionally a thin wrapper
around `llms-full.txt`/`docs.json` already published over HTTPS. Building that eight
times has no payoff: generic documentation-retrieval MCP servers already consume those
files without project-specific code — Context7 (Upstash) is the visible example per the
research pass (not re-verified here), a hosted endpoint indexing a library's repo and
docs site through two generic tools, no libtmux-specific server required. Static
retrieval through `llms.txt`/Markdown, live
interaction through MCP — that split is exactly what libtmux's eight servers already are.

Two moves are worth making, both additive rather than a ninth process. First, generate
each server's in-session guidance from the same source as the docs site: the TS server's
`instructions.ts`/`prompts.ts` and Go's `get_recipe` tool (its `PARITY.md` calls it "the
same text as the MCP prompts, for a client that reads tools and not prompts") should
draw from the same page-manifest records that feed `llms.txt`, so guidance and docs site
cannot drift across hand-maintained copies. Second, optionally add one cheap MCP
resource template per server — `docs://{language}/{symbol}` resolving to the CDN's `.md`
URL — so an agent already in a tmux-control session can look up an API page without a
context switch; I checked the TS server's `resource_catalog.ts` and it only catalogs
live tmux resources, so this is genuinely new and small.

## Structured data: schema.org is decoration; the real asset is the parity ledger

`schema.org/APIReference` (a `TechArticle` subtype) has exactly four API-specific
properties — `assemblyVersion`, `executableLibraryName`, `programmingModel`,
`targetPlatform` — reading as 2012-era Microsoft/.NET vocabulary (`targetPlatform`'s
example value is literally `"Metro style"`, the Windows 8 app model), with no known 2026
search surface rendering a rich result from it. Emit plain `TechArticle` JSON-LD per
page (title, description, `programmingLanguage`, `dateModified`) because it costs
nothing — don't sell it internally as agent discovery.

The structured-data investment worth making is different: every port already re-derives
a symbol-level model of the Python API to check its own parity claims — .NET's
`docs/parity/python-public-api.json` (4,387 rows keyed `module:qualifiedName`, each with
a `sourceUrl` pinned to a Python commit), Rust's `scripts/public-api.py` (from rustdoc's
JSON), Swift's `Scripts/extract-python-parity.py`, Go's `tmux/internal/parity/` — solving
the same extraction problem seven times over. Promoting that into one language-neutral
symbol table, generated once from Python and consumed by every parity script and the
docs-site aggregator for per-symbol JSON-LD, is the natural next step once the
page-manifest infrastructure above exists — out of scope here, but worth flagging.

## Sitemap index across eight prefixes and N versions

`sphinx-gp-sitemap`
(`~/work/python/gp-sphinx/packages/sphinx-gp-sitemap/src/sphinx_gp_sitemap/__init__.py`)
already handles one build correctly: `sitemap_url_scheme` defaults to
`"{lang}{version}{link}"`, with `<xhtml:link rel="alternate" hreflang="...">` siblings
per locale. What it cannot do, since each language/version is a separate invocation, is
aggregate across builds. The missing piece mirrors the `llms.txt` gap: once all eight
languages × N versions have landed, the same aggregator walks the known
`(language, version)` matrix and writes a root `/sitemap.xml` as a `<sitemapindex>`, one
`<sitemap><loc>` per build (`/py/stable/sitemap.xml`, `/ts/stable/sitemap.xml`, ...),
with `robots.txt` pointing at that single index — standard once any one sitemap risks
the 50,000-URL/50 MB cap.

Path-based routing (ledger §1) is load-bearing here, not aesthetic: `llms.txt` is
conventionally expected at domain root, and a sitemap index conventionally references
sitemaps on the same host. Paths give one root `/llms.txt` (H2 per language) and one
root `/sitemap.xml` covering every language and version; subdomains would give eight
disconnected hubs and eight sitemaps each needing separate Search Console submission.

