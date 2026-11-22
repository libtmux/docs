<p align="center">
  <picture>
    <source srcset="site/public/brand/python/library/logo.svg" type="image/svg+xml">
    <img src="site/public/brand/python/library/logo-512.png" width="128" height="128" alt="libtmux">
  </picture>
</p>

# libtmux.org

Documentation for the libtmux libraries in Python, Ruby, Lua, PowerShell,
Julia, Erlang, Elixir, Haskell, Common Lisp, TypeScript, Rust, Go, Java, C#,
C++, Swift, OCaml, Perl, and Raku, with JVM and .NET companion libraries for
Kotlin, Scala, Clojure, and F#. [libtmux.org](https://libtmux.org) provides
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
See [Contributing](.github/CONTRIBUTING.md) for the full check suite and port source
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

Each port has an API reference on `libtmux.org`. Ports with canonical
ecosystem hosts also link to companion references on
[docs.rs](https://docs.rs/libtmux),
[pkg.go.dev](https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux),
[javadoc.io](https://javadoc.io/doc/io.github.libtmux/libtmux),
[Dokka](https://javadoc.io/doc/io.github.libtmux/libtmux-kotlin),
[Scaladoc](https://javadoc.io/doc/io.github.libtmux/libtmux-scala_3),
[HexDocs](https://libtmux.hexdocs.pm/),
[Swift Package Index](https://swiftpackageindex.com/libtmux/libtmux-swift/documentation/libtmux),
and [MetaCPAN](https://metacpan.org/pod/LibTmux).

Read [Architecture](notes/architecture.md) for the build and hosting design,
[Adding a port](notes/adding-a-port.md) for integration steps, and
[Writing](WRITING.md) for documentation conventions.

## AI policy

Use these packages with AI tools as you like. When contributing, check what you
submit and wait for a maintainer's invitation before preparing a pull request.
See the [AI policy](https://libtmux.org/en/meta/ai-policy/), also kept as
[AI_POLICY.md](https://github.com/libtmux/.github/blob/HEAD/AI_POLICY.md).
