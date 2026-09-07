# libtmux.org

Documentation for the libtmux libraries in Python, TypeScript, Rust, Go,
Java/Kotlin, .NET, C++, and Swift. [libtmux.org](https://libtmux.org) provides
installation instructions, task guides, examples, and API references with
links between corresponding APIs in different languages.

## Run locally

Use Node.js 24 or newer and the pnpm version declared in
[package.json](package.json).

Install dependencies:

```console
$ pnpm install
```

Start the Astro development server:

```console
$ pnpm dev
```

This serves the site shell with the cached API models and example sources.
See [Contributing](CONTRIBUTING.md) for the full check suite and port source
requirements.

## Build and preview

Build the Astro shell:

```console
$ pnpm build
```

Assemble the shell, port documentation, reference pages, and search index
into `_site/`:

```console
$ pnpm build:site
```

Serve the assembled site at `http://localhost:8080`:

```console
$ ./scripts/serve.sh
```

[Build scripts](scripts/README.md) documents build options, caching, and
which generated references require sibling port checkouts.

## Repository layout

| Path | Contents |
| --- | --- |
| `site/` | Astro components, guides, examples, and reference pages |
| `packages/api-model/` | API extraction, symbol resolution, and cross-port mappings |
| `packages/theme/` | Shared Tailwind theme plugin |
| `scripts/` | Site assembly, generated data, and validation |
| `infra/` | Hosting configuration for S3 and CloudFront |
| `notes/` | Architecture and port integration guidance |

[ports.ts](site/src/lib/ports.ts) defines port identities, source locations,
and renderers. [versions.ts](site/src/lib/versions.ts) defines version
ordering and canonical URL policy.

Each port has an API reference on this site. Rust, Go, and Java also link to
[docs.rs](https://docs.rs/libtmux),
[pkg.go.dev](https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux), and
[javadoc.io](https://javadoc.io/doc/io.github.libtmux/libtmux).

Read [Architecture](notes/architecture.md) for the build and hosting design,
[Adding a port](notes/adding-a-port.md) for integration steps, and
[Writing](WRITING.md) for documentation conventions.
