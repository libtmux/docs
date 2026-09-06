# libtmux.org

Unified documentation site for every libtmux language port: Python, TypeScript,
Rust, Go, Java/Kotlin, .NET, C++, and Swift — one domain model, one site.

Public. Pull requests welcome — the pages carry an edit link to the file
behind them.

|            |                                                          |
| ---------- | -------------------------------------------------------- |
| Site       | https://libtmux.org                                       |
| Shell      | Astro 7, own layouts and components — no documentation framework |
| Hosting    | S3 + CloudFront, with Cloudflare in front (the layering `git-pull.com` already runs; `libtmux.org`'s own DNS has no records yet) |

## Layout

```
site/            The Astro shell: landing, concepts, guides, examples, parity,
                  search, and the reference pages for the two ports this app
                  renders itself (TypeScript, .NET). See site/src/lib/ports.ts.
packages/theme/   @libtmux/theme, the Tailwind v4 theme plugin the shell and
                  (eventually) the Sphinx theme share.
ingest/           Reserved: loaders that turn each self-hosted port's API model
                  (api-extractor JSON, docfx YAML, ...) into content collections.
                  Not populated yet.
infra/            CloudFront function, bucket policy, and cache-policy notes
                  for the shared S3 + CloudFront distribution every port's
                  own CI deploys into.
scripts/          Reserved: build-site.sh and friends, invoked by the root
                  package.json's `build:site` script. Not populated yet.
notes/            Design notes and decisions for this repo itself, including
                  notes/architecture.md and notes/adding-a-port.md.
```

`site/src/lib/ports.ts` is the source of truth for which port renders where —
read it before trusting a summary of it, including this one.

## Running it locally

```console
$ pnpm install
```

```console
$ pnpm dev
```

`pnpm dev` runs the Astro shell only (`site/`), with no environment set: it
falls back to a root-mounted `latest` build so the site is browsable without
CI's version/base-path variables. See `site/astro.config.ts`'s header comment
for what each `LIBTMUX_DOCS_*` variable does.

## Building

```console
$ cd site && LIBTMUX_DOCS_SKIP_PAGEFIND=true pnpm build
```

That builds the Astro shell alone and is the command to check before pushing
any change under `site/`. `LIBTMUX_DOCS_SKIP_PAGEFIND=true` skips the Pagefind
indexing pass, which needs a full multi-page tree to be worth running.

Building the *whole* site — the shell plus every self-hosted port's reference,
merged into one output tree and indexed together — is `build:site` at the
repo root:

```console
$ pnpm build:site
```

That script (`scripts/build-site.sh`) is not written yet; it is what ties
together each port's own generator output with the Astro shell's build. Until
it exists, `pnpm build:site` fails — this is a known gap, not a broken build
of what does exist today.

## Reference-hosting policy

Every port's API reference reaches the reader one of two ways, decided once in
`site/src/lib/ports.ts` and enforced everywhere else in the site by reading
that file rather than re-deciding per component:

- **Deep-link to the canonical ecosystem host**, when one already exists, is
  free, and stays current on its own without any CI of ours: Rust to
  [docs.rs](https://docs.rs), Go to [pkg.go.dev](https://pkg.go.dev), Java and
  Kotlin to [javadoc.io](https://javadoc.io).
- **Self-host everything else** under our own S3 + CloudFront prefix, with our
  own design system and version scheme: Python and C++ via Sphinx, TypeScript
  and .NET rendered through this Astro app from a generated JSON/YAML model,
  and Swift via DocC skinned with our CSS and header/footer fragments.

Read the Docs is never a target for anything. It is a generic hosting
platform, not a canonical package index the way docs.rs or pkg.go.dev are —
self-hosting gives us the design system, the version scheme, and the URLs
that a Read the Docs project would not.

See `notes/architecture.md` for how this plays out across renderers, versions,
SEO, and search, and `notes/adding-a-port.md` for the checklist to add a
ninth port.
