# Contributing

Contributions should fix a concrete documentation, rendering, or tooling
problem. Keep each change focused and describe its effect on readers.

Read [AGENTS.md](../AGENTS.md) for repository boundaries and
[WRITING.md](../WRITING.md) for prose, comments, and commit conventions.

## Setup

Use the Node requirement and pnpm version declared in `package.json`.
Shared dependency versions live in the `pnpm-workspace.yaml` catalog.

Install dependencies from the repository root:

```console
$ pnpm install
$ uv sync --locked
```

Python tooling lives in `pyproject.toml` and `uv.lock`. The `dev` group
includes `lint` and `testing`; `.python-version` selects the development
interpreter. Keep dependency changes in the manifest and regenerate the
lockfile with `uv lock`. The project applies a three-day package cooldown
so local and CI resolution use the same policy.
The `docs` group supplies the C++ native Sphinx renderer; the Python port
keeps its own source-bound uv environment.

Start the Astro development server:

```console
$ pnpm dev
```

## Toolchain constraints

`@astrojs/check` accepts TypeScript 5 or 6 as a peer dependency. The site's
`astro check` and Astro language tooling depend on the compiler's language
service API; a compiler upgrade must preserve that integration. Follow the
TypeScript 6 constraint in [AGENTS.md](../AGENTS.md#change-discipline).

The plain TypeScript packages extend the root `tsconfig.json`. The site
extends Astro's strict configuration instead. Keep both paths working when
changing shared compiler settings.

## Linting and formatting

`oxlint` is the workspace linter; `oxlint-tsgolint` supplies its type-aware
rules. Both are pinned centrally in the pnpm catalog. Package lint scripts
use `--type-aware` with their own `tsconfig.json`; the root command also runs
Oxlint over `scripts/`. Preserve each script's scope and exclusions.

The root lint command also runs Ruff's lint and format checks on Python
tooling under `scripts/`. Run `uv run --locked ruff format .` to format
those files; generated examples and documentation snippets keep their own
verification rules.

Run lint across the workspace and build scripts:

```console
$ pnpm run lint
```

The theme package retains Biome in its formatting script; it is not the
workspace lint gate. This command writes changes, so review its diff:

```console
$ pnpm --filter @libtmux/theme format
```

## Checks

Run workspace type checks:

```console
$ pnpm run type-check
```

This runs `astro check` for the site and Oxlint's type-check mode for the
plain TypeScript packages, plus `uv run --locked ty check` for Python
tooling. Ty treats warnings as failures. The theme also exposes
`type-check:tsc` for a direct compiler check; it is separate from the root gate.

Use the inner loop for cross-port mappings, native navigation, and native
asset normalization:

```console
$ pnpm test:inner
```

Run workspace unit suites, lint, API links, and generated mention/navigation
freshness checks in the medium loop:

```console
$ pnpm test:medium
```

Run the outer loop before committing:

```console
$ pnpm test
```

The outer loop includes the `*.outer.test.ts` integration suites, which seed
the full API catalog, run native compiler comparisons, or exercise subprocess
shutdown. Elixir exporter fixtures and live clang-format comparisons run here;
the medium loop keeps the pinned formatter fixtures. It also adds type
checks and starts its own Astro development server
from current source. Browser checks cover prose, an MCP table, row permalinks,
API equivalents, and phone dropdown placement at 1440, 768, and 390 pixels. The
sampled renderer also checks homepage choices and uses
`node site/scripts/check-dev.mjs --sample`. It does not reuse `_site`. The
runtime budgets are under 2, 10, and 60 seconds for inner,
medium, and outer respectively; measure the complete pnpm command when
changing a loop. `test:fast` aliases medium. The runner stops an over-budget
loop and fails.

The medium and outer loops first stage the integrated Ruby and Lua guides
from local Git objects. Each revision comes from `site/src/data/api/<port>.json`;
the checkout's current branch and uncommitted files do not affect these guides.
Keep those repositories at their standard `checkout` paths in `ports.ts`, or
set `LIBTMUX_DOCS_CHECKOUT_RUBY` and `LIBTMUX_DOCS_CHECKOUT_LUA` to local clones
containing the required commits. Missing repositories or commits fail with
the required revision and environment variable. The gate does not fetch;
a fresh docs clone needs these source checkouts before `pnpm test`.

Browser checks use Playwright's installed Chromium by default. To use local
Chrome:

```console
$ LIBTMUX_DOCS_BROWSER_CHANNEL=chrome pnpm test
```

To keep local browser checks on a fixed port, stop the preview using that
port, then run:

```console
$ LIBTMUX_DOCS_BROWSER_PORT=53971 pnpm test
```

The value must be an integer from 1 to 65535. An occupied explicit port fails
the check instead of selecting another port. This setting also applies to
direct `check-dev.mjs` invocations, including `--serve`; without it, automated
checks select an available port and `--serve` uses 53971. Restart the shared
preview after the checks finish.

Install the pinned Chromium build for local browser checks with
`pnpm --filter @libtmux/site exec playwright install chromium`. CI installs
that build and its system dependencies before the publication audit.
The standard ten-second browser timeout increases to twenty seconds on CI.

Each engine aligns the sticky Members and group headings of a reference page
differently. The publication audit checks them in Chromium; install Firefox
and WebKit to check all three:

```console
$ pnpm --filter @libtmux/site exec playwright install firefox webkit
```

Then run the sticky heading check, which starts its own server and drives
focus, link, repeated link and typed hash arrivals in each engine:

```console
$ node site/scripts/check-dev.mjs --api-sticky
```

A heading's `#` permalink stays quiet on a fine pointer and appears when its
heading is hovered, focused with the keyboard or targeted by the URL. Touch and
forced colours keep it in view. The check reads computed opacity, the tab stop
and the accessible name on a Swift and a Python reference page, in light and
dark, with and without JavaScript, and ends with controls that break each
state and require the check to notice:

```console
$ node site/scripts/check-dev.mjs --permalink-reveal
```

Kind marks centre their ink by measurement, and a legend chip, split chip or
modifier chip is one line of text. The badge gate reads the pixels of real pages
at 1x and at a real 2x device scale factor (Chromium launched with the factor,
because the emulated factor snaps text to CSS pixels), in light and dark. It
measures the mark that leads a name in cards and lists, the related-APIs
chips, the group headings, the MCP section menu's rule (a mark only in a group that
mixes kinds, and no gutter) and that the API tree indents each row whole, one
level at a time, and it checks that only the first mention of a name in a
section carries a mark. A chip grows with a name that wraps, so a related chip's
mark is held flush with its corner and as tall as the first line. The gate
measures the Related APIs chips on the Scala Server, Session, Window, Pane and
Client pages at 1440 pixels, where a name wraps onto several lines, and requires
each chip to hold its name and clear the next. It reads the chips of the usage
table on the `list-panes` manual page the same way, and requires a chip with a
qualifier to keep the width its name needs, with the qualifier beside it or
under it. Each check ends with a negative control that breaks what it holds and
requires the gate to notice, by the problem it names:

```console
$ node site/scripts/check-dev.mjs --badge-centring
```

A link the page marks for a preview card must have a card to show. The preview
check hovers the C function link of a method page, then asks for the payload of
every marked link on four pages. It asks only for destinations the dev build
serves: one version of each port's reference, as its build target says, so the
Python reference that the other ports link to at its default version is not asked for. What
it leaves out is bounded: only reference trees whose publisher owns the version
tree (`publishesOwnTree`), at versions the dev build does not serve. A payload
missing on a port the build does serve is reported, and the check fails if it
would not report one. Both checks run in the publication audit through the full
`check-dev.mjs` matrix, on its own source mirror and not on the assembly. The
trees it leaves out are the shell's own in the assembly (each port's shell build
renders `<slug>/<version>/reference/`), and `reference-previews.test.ts` reads
every port and tmux tree there and requires a payload beside each page a link is
marked for:

```console
$ node site/scripts/check-dev.mjs --reference-previews
```

Keep the complete assembly, all output suites, link audits, source/model
freshness, and full browser matrix in the publication audit:

```console
$ pnpm test:publication
```

This audit is not limited to 60 seconds. `scripts/test-all.sh` defines it;
`.github/workflows/test.yml` runs it in CI. Report skipped checks explicitly.
It runs the complete fresh-source browser matrix with
`node site/scripts/check-dev.mjs`, including every homepage language and detail
level, before assembly. The outer loop keeps only its bounded rendering sample.
Missing port checkouts, a missing local server, or a missing `shellcheck`
can leave publication checks unexercised. Development loops deliberately exclude assembled-output
suites; they do not establish publication readiness.

Add focused regression coverage for behavior changes and confirm that a new
check fails when its intended invariant is broken. Root policy-guide edits
need link, command, and diff review rather than new tests. Content edits
under `site/` still need the relevant rendering, example, and link checks.

### Theme test setup

`packages/theme/src/test-utils.ts` compiles CSS through the real Tailwind
plugin. Reuse it for output assertions. The package's `vitest.config.ts`
loads `src/test/setup.ts`, whose serializer normalizes only the Tailwind
version banner. Preserve that setup; changes to selectors or CSS structure
must remain visible in snapshots.

### Example line width

Code in `site/src/content/docs` stays within 80 columns, counting a tab as
eight and a wide glyph as two (`CODE_COLUMNS.example` in
[`code-layout.ts`](../site/src/lib/code-layout.ts)). Many pages already run
over, so [`example-columns.test.ts`](../site/test/example-columns.test.ts) holds
each page to the count recorded in
[`example-columns.json`](../site/test/fixtures/example-columns.json) rather
than to zero. It fails when a page's count grows, when a page the baseline
does not list has any line over, and when a count shrinks while the baseline
still holds the old number. A fix lowers the baseline in the same commit.

Every code block counts, fenced or indented, at any depth in a list or a
quotation. That includes `text` fences, which also label diagrams, and the
command lines of a `console` session, which
[WRITING.md](../WRITING.md#markdown-and-examples) says to split with `\`.
Two kinds of recorded output are exempt, because a reader cannot reformat
them: `output` and `log` fences, and the output lines of a `console` or
`shellsession` block, as the site's own prompt reader sees them. The exemption
is a rule, not a record of current lines. A `file=` or `excerpt=` fence has no
text in the page; the port's formatter sets its width. Pages staged from a
port's repository (`_staged/`) are generated, gitignored and owned there.

After shortening lines, lower the baseline:

```console
$ node scripts/gen-example-columns.mjs
```

The script refuses to raise a count or to record a page that is not listed.
A page moved to a new path keeps its entry with `--rename old=new`, which
accepts a page that has no more lines over than the entry recorded. Pass
`--force` only when growth is intended, and say why in the commit.

### Links between ports and guides

[`concepts.ts`](../packages/api-model/src/concepts.ts) maps equivalent APIs by
their public symbol IDs. Check behavior and scope in each port's source
before adding a mapping. Record an absence when a port has no equivalent;
similar names alone do not establish one. An overloaded page can belong to
several concepts. The page dropdown and "In other ports" use these mappings,
and tests require every mapped target to resolve.

A tmux command page links the methods that send the command, and a method
page links the command and the C function behind its scope. Those links come
from each port's source at the revision its API model was extracted from, not
from concepts: a method that only reads a captured snapshot has no link, and a
plan or chain that only records a command is an exclusion with cited lines. After
a port's model changes revision, regenerate the usage data with the port
checkouts present:

```console
$ node scripts/gen-tmux-usage.mjs
```

"Discussed in" comes from API mentions in guides, including tables and
sections headed with a port name. After editing those mentions, regenerate
the index:

```console
$ node scripts/gen-mentions.mjs
```

Workspace prose links a code span that names a CLI command, option or
configuration key to its entry in the port's CLI Manual or Configuration
reference. Those destinations come from an index of the workspace pages. After
adding or renaming a CLI page, a table of options, or a table of keys,
regenerate it:

```console
$ node scripts/gen-workspace-entities.mjs
```

A bare name links only on a user-facing workspace page, where it outranks a
library symbol or tmux name of the same spelling. `<program> <command>` links
on any page of a port that ships the program. Internals pages and the language
API index keep their library symbols.

The publication audit checks index freshness, rendered links, navigation targets,
and table layout at desktop, tablet, and phone widths.

### Header destinations

The port header links each repository, package page and API reference that
[`port-inventory.ts`](../site/src/lib/port-inventory.ts) publishes. Two generated
files hold it to the facts. `site/src/data/manifest-packages.json` lists what
each port's owning manifests declare at the revision its API model is pinned to,
and the inventory's tests require the two to agree in both directions. After
changing an entry, or moving a port's pin, regenerate it from the local
checkouts:

```console
$ node scripts/gen-manifest-packages.mjs
```

A status in the inventory is a claim about a live host, so check it against the
host after changing an entry or when a package is released:

```console
$ node scripts/verify-destinations.mjs
```

The command requests each URL once, read-only. It requires the host's own
identity for the package, not only a 200; a repository that a registry reports
must be one of the entry's; and the version the manifest declares must be on
every host that lists versions, with the record saying so where one cannot. It
rewrites `site/src/data/destination-evidence.json`, which the unit tests and the
publication audit compare with the inventory offline. The command exits 1 when
a published destination fails or an unlinked one starts to answer; commit the
evidence with the inventory change that follows.

Age is enforced only where a live run is the remedy. Evidence older than
`EVIDENCE_MAX_AGE_DAYS` in `scripts/lib/destination-verification.mjs` makes the
offline comparison print a warning with the date of the records (a `::warning::`
annotation under GitHub Actions), and nothing more, so a change that touches none
of this does not fail because time passed. A live run ends by requiring every
record to be within the bound, and a record dated more than a day ahead is
refused wherever it appears, so evidence cannot be committed back-dated or
forward-dated. The weekly
[`verify-destinations.yml`](workflows/verify-destinations.yml) runs the
live verifier into a temporary file and then
`node scripts/verify-destinations.mjs --check --fresh` against the committed
evidence; it fails on a destination that no longer passes or on evidence past
the bound, and is not a dependency of the test or deploy workflows
([CI](../docs/ci.md#header-destination-check-verify-destinationsyml)).

### Standard-library and SDK destinations

A link into a language's own documentation, or into an SDK this estate builds
on, is held to more than a 200. [`api-destinations.mjs`](../scripts/lib/api-destinations.mjs)
reads every one the site generates: the curated maps in
[`builtins.ts`](../packages/api-model/src/builtins.ts), the cached inventories,
the references in the extracted doc comments, the links in pages (the content tree, the guides staged
from each port's artifact, and the workspace pages written once for every port), guide data, the glossary,
and the heading each of PowerShell's common parameters has on its Microsoft Learn page. Each is requested once and must land on a page whose own
declaration is the symbol the link was made for.

A documentation page says what it documents, in the markup its host uses, and
says it more exactly than its address or a word in its title:
[`api-identities.mjs`](../scripts/lib/api-identities.mjs) reads rustdoc's title and
heading, javadoc's package line and the parameters a member's anchor spells,
Dokka's breadcrumbs and declaration, Scaladoc's kind, cppreference's heading
and declaration, ExDoc's `c:` and `t:` anchors and operand count, fsdocs' Module
or Type, Learn's namespace and generic arity, CPython's `dl.py` role,
pkg.go.dev's full import path and kind, Documenter's category, MDN's title and
DocC's symbol kind. [`api-sources.mjs`](../scripts/lib/api-sources.mjs) says the same of the name that led
there: its kind, the package, module or type written before it, its operand
count and its parameter list where the name gives them. A link is right when the
two agree. `Option<T>::map` keeps its `map`, `System.getenv()` is the overload
that takes nothing, and `std::map` is not `std::unordered_map`, `std::optional`
not `std::bad_optional_access`, and `Flow` not `flow()`. A name written bare
needs an owner: `BARE_OWNERS` in `api-sources.mjs` is what each port imports, and
`DEFAULT_SCOPES` is what its language provides, so `Duration` in Java is
`java.time.Duration` and a bare `run` in Python is nobody's. A bare name that no
table covers is refused rather than guessed. The scopes are per name where a language binds
them so (`DEFAULT_NAMES`: Scala's `Map` and `Set` are `immutable`'s, `Iterator` is
`scala.collection`'s, as Predef and the package object bind them), a name written bare
in a file that opens its namespace is read from the port's model (F#'s `open`s), and a
type a member's docs extend is matched exactly, never by the end of its name. A page
of a host we read that declares no symbol (a search page, a manual section) is no symbol,
whatever its title says. A host that publishes no declaration at all (the TypeScript
handbook, the Lua manual, the JLS) is read by its fragment and its title, and a symbol
name there passes only by an exception.

A link a person wrote is a fact, and it is reviewed as one. Every Markdown link in a page, term in
the glossary, link in a doc comment and title a keyword's help carries is a pair of its exact text and
its exact address, and where its page documents no symbol it is a row of
[`api-link-review.json`](../site/src/data/api-link-review.json): the text, the address with its
fragment, and the heading the page has there (the heading the fragment opens, else the page's own top
heading). The verifier checks two things and matches nothing by likeness. Every pair the source writes
is a row and every row is a pair the source writes, so a text planted at another address, a narrower
page, a page of another language or a heading that shares a word with it fails as unlisted. And the
page's heading at the address is the row's, so a page rewritten or moved under the link fails as
drift. Adding a link means adding its row: a failing run prints the heading it found and the row to
add, and a person reads both. A text that is exactly the name of the symbol its page declares needs no
row: it is compared with the name, exactly (`Files` is `Files`, never `File`; `Option::map` ends the
page's path, owner included; a call written out is its callee; `Result` is `std::result`'s), and
words that describe the page are not a name. A row on a page that declares a symbol (`Python class
methods` at `classmethod`) is recorded under the symbol's full name. Language is read from the
address, never from the words: each port goes to its own language's documentation and to what its
platform shares (Kotlin and Scala to the Java hosts, C#, F# and PowerShell to the .NET API, runtime,
standard library and NuGet pages of Microsoft Learn, and no port to another product's pages there),
and a link a port writes to any other fails (`PORT_LANGUAGES` in
[`api-links.mjs`](../scripts/lib/api-links.mjs)). The same words at the same address written for several
ports are held for each of them, and a port the table does not know, or an address whose language it
cannot read, fails rather than passes unchecked. The links in a page are read by a Markdown parser
([`api-markdown-links.mjs`](../scripts/lib/api-markdown-links.mjs)), so a link with a title, an autolink,
a reference link, a `<url>` definition, a raw `<a>` or code with brackets in its words is a pair like
any other. An address is read the way a browser reads it (`HTTPS://` and `http://` in any case, a
protocol-relative `//host`, a host with a dot after it, a bare `www.` host), and an address on an API
host that no link accounts for (in a code span, a fence, front matter, an image, a definition nothing
uses, or a sentence) fails as a link with no words to review. The pages of the libtmux packages
themselves belong to the header verifier, which records the package each is and the ports that publish it;
a link to one is a pair like any other, held to the port that writes it and, by its row, to the package
it names. `meta/` pages are the site's own credits and licences: their links to a language's website
are logo and licence terms, not API documentation, so only their links to those package pages are read.
`json-schema.org`, which `mcp-schema.ts` links for the type words of a tool's schema, documents a data format
and not a language or an SDK, so it is not one of the hosts read (`API_HOSTS`).

Prose is read the way the page renders it. A symbol's documentation (`PROSE_FIELDS` in
[`prose-fields.ts`](../packages/api-model/src/prose-fields.ts)) is linked by `SymbolIndex.docSpans`, the
function `ApiDoc` renders with, over the text `ApiDoc` receives: the field itself, or the paragraphs and
list items `ApiProse` splits it into, with fenced code left alone. A link the site writes from the model
(a command's facts, a parameter's binding) is the builtin it names. Every other string a symbol holds
is in `STRUCTURAL_FIELDS`, and a test fails on a string in neither, and on an expression a component
passes to `ApiDoc` or `ApiProse` that `RENDERED_TEXTS` does not list, so a field the extractor adds, or
a field a component starts to render, is decided before it ships. A variable is the reader's own and
links nowhere, a printed `[object Object]` is text (`neverLinks`, read by the type tokenizer every
path calls and by the prose linker), and a language's keywords (`for`, `import`) are documented at
the top level (`BARE_OWNERS` in `api-sources.mjs`).

A name in prose is linked by one function, `decideMention`, and a port's own curated names come before the
inventory of the platform it runs on, in a page and in a symbol's documentation alike (`CURATED_BEFORE_INVENTORY`):
Scala's `Vector` and Kotlin's `Flow` are not `java.util`'s, and a name only the JDK or the Java library has is
Java's where the sentence says Java (`PLATFORM_REACH`). The language a sentence names is read by whole words, and a
path, a URL or a dotted name names none: `JavaScript` is not `Java`, and `options-table.c#L359` is not C#.

The same prose reaches a reader by more than one route, and the tests render each one and hold the
verifier to it: every page the site builds, staged guides and shared workspace pages included
(`proseSources`, which the collector reads too), in the build of each port and in the one build for none,
through the linker the site uses; the Markdown copy of a symbol and of a page (`llmsPage`, which `llms-full.txt`
and every `.md` twin carry); the documentation, types and PowerShell common parameters of every symbol,
drawn by `ApiDoc`, `ApiType` and `ApiCommandParameters` as the site compiles them; the hover card; the
descriptions, summaries, arguments and schema texts of every MCP object, through `renderToolDescription`; and the
notices in templates. A link the linker makes must also reach the language its page reads as, or the one its
sentence names, and the entry its port curates for that name. A page shared by every port is rendered once for each, and the port of that build
says where it is read, not what it is about, so it links a bare lowercase word to that port's standard
library only where the page (its own port, a fence, a row, a section or the sentence) says its
language, and a name that carries evidence of its own (`Base.strip`, `BTreeMap`, a call) anywhere: a
shell's `exit` is not Python's. A test lists every file that links prose or holds an index to link with, by any call, in any
directory or extension, and fails on one that is not listed with what it does with an address outside the
site. A file that gives a Markdown processor the page linker's plugin (`rehypeApiLinks`) is one of them.

A host that moves the
page elsewhere, even by the case of a letter, fails, because a link should be
the page's address. Request the missing ones after changing a map, an
inventory or a pinned model:

```console
$ node scripts/verify-api-destinations.mjs --missing
```

The command is sequential and pauses between requests; it keeps fetched pages
for twelve hours (`--no-cache` asks again). A host that blocks the request,
throttles it or renders the page in the browser is recorded as unverifiable
with one of a closed list of reasons and is never counted as passing; the
offline check prints every one as unresolved. The cached inventories (CPython,
Julia, the JDK and the web platform) are checked whole against the index each
host publishes, and bound to the entries they held by a digest:

```console
$ node scripts/verify-api-destinations.mjs --inventories
```

The evidence is `site/src/data/api-destination-evidence.json`, and each passing
record keeps the identity its page declared. `--check` requests nothing, but it
judges every name the source generates again, now, against that recorded
identity: a builtin edited over the same address fails. It also fails a
destination with no passing record, two records for one address, a record for a
link nothing makes, an identity that disagrees with its own address, a pass
that rests on an exception that is no longer listed, and any difference between
the links the source writes and the rows of the link table (a link with no row,
a row for no link, a row twice, a row for a text that needs none, a record whose
heading is not its row's). `PAGE_EXCEPTIONS` in
`scripts/lib/api-destinations.mjs` carries the exceptions, one entry per exact
address with the names it covers and its reason: `listed` for a name a page
documents beside its subject rather than in its title (`std::chrono::milliseconds`
on the `duration` page, and on no other), `section` for an anchor that documents
several symbols or is spelled as a heading (the Lua manual's value types, the
typespec reference), where the section the anchor opens must still name the
symbol. Add to it only after reading the page. A name
that a language spells another way (`int` for `Int32`, `string` for `String`)
goes in `TYPE_ALIASES`, and a package that two spellings share in
`NAME_ALIASES`. `--check` also fails a record that contradicts itself (a pass
with a 404, a failure field or a redirect), an unverifiable record that gives a
reason of its own, and a run that left more than a few destinations
unverifiable, because that run checked nothing.
`scripts/verify-api-destinations.negative.mjs` plants a wrong fragment, a wrong
page, a symbol the page does not document, a word that merely contains the
symbol, a wrong package or namespace, a wrong kind, operand count or parameter
list, a bare name in the wrong scope, words on a link that name another symbol,
an exception borrowed by another page, an unlisted link, a drifted heading, a
link written for the wrong language or several ports, each form a Markdown link
takes, an address outside any link, a case-only redirect and a redirect to a
landing page on pages shaped like the real ones, each fault in the evidence, and
each edit of the source over an unchanged record, and requires the check to name
each. The weekly
[`verify-destinations.yml`](workflows/verify-destinations.yml) re-runs
the live check; pull requests never do.

## Building and previewing

Build the Astro shell:

```console
$ pnpm build
```

Assemble the complete site into `_site/`:

```console
$ pnpm build:site
```

Port inputs use the checkout and worktree locations in
`site/src/lib/ports.ts`. See [Adding a port](../notes/adding-a-port.md) for
preparing docs-tooling worktrees and generator inputs.

Serve the assembled output with Python 3:

```console
$ ./scripts/serve.sh
```

The server listens at `http://localhost:8080`. Leave it running in another
terminal when running the publication audit to exercise browser checks. Style parity
also requires the generated Sphinx pages; check the run's skip summary.

Stop development and preview servers, then remove generated output and staging:

```console
$ pnpm run clean
```

Add `--dry-run` to list the directories or `--cache` to remove cached shell
and reference builds too. Cleanup shares the assembly lock and refuses to
run during an assembly. It preserves source, dependencies and `output/`
review evidence. Custom output and cache locations need their own cleanup.

## Pull requests

Keep commits focused on one topic. Explain the problem, resulting behavior,
and verification, including failures or skipped checks. Keep unrelated
cleanup in separate work.

Follow [WRITING.md](../WRITING.md#commits) for commit messages and
[AGENTS.md](../AGENTS.md#repository-boundaries) for push and deployment limits.
