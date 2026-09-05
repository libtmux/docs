# libtmux.org — documentation site research

Research and design for a single static documentation site covering all eight libtmux
language ports, with one visual identity, versions and translations, served from
S3 + CloudFront.

Produced 2026-09-02. Start with `00-DECISIONS.md`.

## The short version

**A hand-owned Astro site owns the shell. Two renderers produce reference pages. Four
languages keep their native generator, skinned.** Path prefixes on one domain, not
subdomains.

No Starlight, and no documentation framework of any kind — Astro is a build tool and a
component model here, nothing more. Every layout and component is ours. The starting
point is not a blank page: `~/work/typescript/social-embed/packages/site` is already a
working owned-Astro docs site that was migrated off Starlight (PR #55), and its layouts,
sidebar, ToC, MDX components, search island and Pagefind build hook port directly.

```
libtmux.org/                     shell, English
libtmux.org/ja/                  shell, Japanese
libtmux.org/py/v0.46.2/          immutable version
libtmux.org/py/stable/           separate build, own canonical
```

| Language | Reference generator | Who renders the page |
|---|---|---|
| Python | Sphinx + `sphinx-gp-theme` | Sphinx — unchanged from today |
| C++ | Doxygen XML → Breathe | Sphinx — same theme as Python |
| TypeScript | api-extractor JSON | our Astro components — TypeDoc is unusable |
| .NET | `docfx metadata` YAML | our Astro components |
| Go | doc2go `-embed` fragments | our Astro components |
| Rust | rustdoc | itself, skinned |
| Java + Kotlin | Dokka | itself, skinned |
| Swift | DocC | itself, skinned |

Four architectures were designed and scored; this one is a synthesis of the two that
scored highest. The runner-up, "Thin Shell", is a legitimate lower-effort fallback that
deliberately gives up the uniform-design goal for two languages. That trade-off is
yours to make and is set out in `00-DECISIONS.md` §5.

## Six things the research changed

1. **TypeDoc is unusable for libtmux-ts.** Not a version warning — TypeScript 7 is the
   Go-native compiler rewrite and removed the classic Compiler API, so TypeDoc crashes
   on `typedoc --version`. Verified by running it. Everything downstream of TypeDoc
   (`typedoc-plugin-markdown`, `starlight-typedoc`, `sphinx-js`) is blocked identically.
2. **Starlight was not buying what we needed.** It has zero first-party versioning
   (verified: no changelog match, discussion #957 stale since 2024-06-12), and its
   Pagefind integration — the other headline feature — is about forty lines. Owning the
   shell costs far less than the framework lock-in it avoids.
3. **Swift DocC does not need SPA route rewriting.** `--transform-for-static-hosting`
   writes a real `index.html` per route. This was asserted both ways by different
   research passes; source settled it. The CloudFront function stays simple.
4. **`/stable/` must be a separate build** — but not for the reason usually given.
   Six of seven generators emit page-relative links, so the same bytes *would* serve at
   two prefixes. Canonical tags and sitemaps are what bake absolute URLs.
5. **`sphinx-multiversion` works and is in a maintenance stall.** Its "old content,
   current design system" behaviour is real and was reproduced. It is also broken
   against Sphinx 9 with the fix unmerged for 8 months.
6. **The design system is not what the prompts assumed.** `sphinx-gp-theme` renders
   production today; `gp-furo-theme` is the in-progress Tailwind rewrite.

## Contents

### Decisions and evidence

| File | Contents |
|---|---|
| `00-DECISIONS.md` | **Authoritative.** The recommendation, the verified fact ledger, the one trade-off you need to decide, and — in §7 — rulings on thirteen disagreements found across the other documents. Read §7 before acting on any single document. |
| `21-verification-ledger.md` | Raw output of ten adversarial verifiers, with evidence. One claim confirmed, one refuted, eight corrected. |
| `25-as-built.md` | What implementation proved, disproved and changed. Written from a running site; supersedes the others where they disagree. |
| `22-study-clones.md` | The 45 tools cloned to `~/study/`, with upstream HEAD dates as a staleness signal. |

### Architecture

| File | Contents |
|---|---|
| `01-architecture-options.md` | All four candidate architectures, the three judge lenses, why the synthesis won, and the Starlight-to-owned-Astro decision with its evidence. |
| `02-shell-contract-matrix.md` | What each generator lets you change: base path, head injection, header/footer, machine-readable output, search, templates. |
| `03-design-token-bridge.md` | Making eight generators look like one site. The per-generator adapter problem, dark-mode unification, and what is not worth skinning. |
| `11-information-architecture.md` | Sitemap, shared concept pages, the parity matrix, and the cross-language example pages. |
| `24-astro-shell.md` | The owned Astro shell: what ports from `social-embed`, what is new, and how eight API models enter as content collections. |
| `23-roadmap.md` | Phasing, decision gates and tracked risks. |

### Cross-cutting systems

| File | Contents |
|---|---|
| `04-versioning.md` | URL scheme, the manifest, the switcher across eight generators, branch vs tag docs, SEO. |
| `05-i18n-translations.md` | What is translatable, the chosen URL shape, and translation management for a solo maintainer. |
| `06-aws-s3-cloudfront.md` | Bucket layout, OAC, the CloudFront function, cache headers, OIDC, PR previews. |
| `07-ci-topology.md` | Publishing one site from eight independent repositories without a shared build image. |
| `08-search.md` | One search across heterogeneous generator output. |
| `09-licensing.md` | The audit, and the distinction that decides it: running a GPL tool vs importing one. |
| `10-llms-and-agents.md` | `llms.txt`, Markdown twins, sitemaps, and whether a docs MCP server is worth building. |

### Per language

| File | Language |
|---|---|
| `12-lang-python.md` | Python — the reference implementation |
| `13-lang-typescript.md` | TypeScript — the hardest lane |
| `14-lang-rust.md` | Rust |
| `15-lang-go.md` | Go |
| `16-lang-java-kotlin.md` | Java and Kotlin |
| `17-lang-dotnet.md` | .NET and C# |
| `18-lang-cxx.md` | C++ — where the licensing question lives |
| `19-lang-swift.md` | Swift |

### Context

| File | Contents |
|---|---|
| `20-existing-assets.md` | The gp-sphinx monorepo, the current Python docs and CI, and per-port material that could become site content. |

## How this was produced

Three agent fan-outs, roughly 5 million tokens:

1. **Research** — 27 agents. Eight language tracks each researched the 2026 landscape,
   shallow-cloned the candidates, then filled a capability matrix by reading the cloned
   source. Eleven cross-cutting agents covered the SSG bake-off, versioning, i18n, CDN,
   search, the token bridge, prior-art IA, licensing, machine-readable output, existing
   local assets, and CI topology.
2. **Verification** — 10 adversarial agents, each told to refute one load-bearing claim
   and to prefer running a command over reading a document. Then four independent
   architecture proposals and three judge lenses.
3. **Writing** — one agent per document, all working from `00-DECISIONS.md`, followed by
   a cross-check audit pass whose findings became §7.

Claims that could not be established from source or by running something are marked
unverified. That distinction is deliberate and worth preserving in any edits.
