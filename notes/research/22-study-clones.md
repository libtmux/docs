# Study clone inventory

45 documentation tools and reference sites were shallow-cloned during this research,
totalling roughly 1.8 GB under `~/study/`. Every capability claim in this folder that
cites a flag, config key or license was checked against one of these checkouts rather
than against a changelog.

Clones follow the existing `~/study/{language-or-domain}/{project}` convention. All were
created with `git clone --depth 1` except `rust-librustdoc`, which uses a partial sparse
checkout because a full `rust-lang/rust` clone exceeds 1 GB.

All 45 are registered in the vcspull manifest as of 2026-09-02, one commit per
directory.

## Re-cloning

To refresh a single tool:

```console
$ git -C ~/study/typescript/typedoc fetch --depth 1 origin
```

The `rust-lang/rust` checkout needs the sparse form, which pulls only the rustdoc
sources instead of the whole compiler tree:

```console
$ git clone \
    --depth 1 \
    --filter=blob:none \
    --sparse \
    -- https://github.com/rust-lang/rust \
    ~/study/rust/rust-librustdoc
```

Then restrict it to the two directories that matter:

```console
$ git -C ~/study/rust/rust-librustdoc sparse-checkout set src/librustdoc src/doc/rustdoc
```

These clones are study material, not dependencies. Nothing in the libtmux repositories
references them, and they can be deleted and re-cloned at will.

## Inventory

`Upstream HEAD` is the date of the single commit each shallow clone carries, which is a
useful maintenance signal: a 2023 or 2024 date on an actively-used tool is a staleness
warning, not a clone artefact.

| Path | Upstream | Upstream HEAD | Size |
|---|---|---|---|
| `~/study/c#/DefaultDocumentation` | Doraku/DefaultDocumentation | 2026-08-26 | 5M |
| `~/study/c#/docfx` | dotnet/docfx | 2026-09-01 | 344M |
| `~/study/c++/doxygen` | doxygen/doxygen | 2026-08-31 | 48M |
| `~/study/c++/mrdocs` | cppalliance/mrdocs | 2026-08-26 | 34M |
| `~/study/c++/poxy` | marzer/poxy | 2026-08-05 | 9M |
| `~/study/docs/cloudfront-markdown-for-llms` | sh-cloud-software/cloudfront-markdown-for-llms | 2026-02-14 | 1M |
| `~/study/docs/kubernetes-website` | kubernetes/website | 2026-09-02 | 4M |
| `~/study/docs/opentelemetry.io` | open-telemetry/opentelemetry.io | 2026-09-02 | 174M |
| `~/study/docs/readthedocs.org` | readthedocs/readthedocs.org | 2026-09-02 | 58M |
| `~/study/golang/doc2go` | abhinav/doc2go | 2026-05-26 | 3M |
| `~/study/golang/gomarkdoc` | princjef/gomarkdoc | 2023-08-19 | 2M |
| `~/study/golang/pkgsite` | golang/pkgsite | 2026-08-17 | 56M |
| `~/study/java/crowdin-cli` | crowdin/crowdin-cli | 2026-09-01 | 10M |
| `~/study/java/jdk-javadoc` | openjdk/jdk | 2026-09-02 | 20M |
| `~/study/javascript/amazon-cloudfront-functions` | aws-samples/amazon-cloudfront-functions | 2024-11-21 | 1M |
| `~/study/kotlin/dokka` | Kotlin/dokka | 2026-08-14 | 85M |
| `~/study/python/breathe` | breathe-doc/breathe | 2025-12-01 | 4M |
| `~/study/python/exhale` | svenevs/exhale | 2024-01-20 | 3M |
| `~/study/python/pydata-sphinx-theme` | pydata/pydata-sphinx-theme | 2026-09-02 | 13M |
| `~/study/python/sphinx-intl` | sphinx-doc/sphinx-intl | 2026-08-30 | 1M |
| `~/study/python/sphinx-js` | pyodide/sphinx-js | 2026-08-04 | 2M |
| `~/study/python/sphinx-multiversion` | sphinx-contrib/multiversion | 2025-11-24 | 1M |
| `~/study/python/sphinx-notfound-page` | readthedocs/sphinx-notfound-page | 2026-01-19 | 2M |
| `~/study/python/sphinx-polyversion` | real-yfprojects/sphinx-polyversion | 2026-07-29 | 1M |
| `~/study/python/sphobjinv` | bskinn/sphobjinv | 2026-03-23 | 4M |
| `~/study/python/weblate` | WeblateOrg/weblate | 2026-09-02 | 366M |
| `~/study/rust/docs.rs` | rust-lang/docs.rs | 2026-09-01 | 35M |
| `~/study/rust/rust-librustdoc` | rust-lang/rust | 2026-09-02 | 19M |
| `~/study/rust/rustdoc-md` | tqwewe/rustdoc-md | 2025-10-29 | 1M |
| `~/study/rust/rustdoc-types` | rust-lang/rustdoc-types | 2026-07-29 | 1M |
| `~/study/rust/sphinxcontrib-rust` | https://gitlab.com/munir0b0t/sphinxcontrib-rust | 2026-07-19 | 1M |
| `~/study/swift/jazzy` | realm/jazzy | 2026-06-30 | 14M |
| `~/study/swift/swift-docc` | swiftlang/swift-docc | 2026-09-02 | 48M |
| `~/study/swift/swift-docc-plugin` | swiftlang/swift-docc-plugin | 2026-04-28 | 4M |
| `~/study/swift/swift-docc-render` | swiftlang/swift-docc-render | 2026-09-02 | 7M |
| `~/study/typescript/docsearch` | algolia/docsearch | 2026-08-24 | 77M |
| `~/study/typescript/docusaurus` | facebook/docusaurus | 2026-09-01 | 115M |
| `~/study/typescript/fumadocs` | fuma-nama/fumadocs | 2026-09-02 | 103M |
| `~/study/typescript/rspress` | web-infra-dev/rspress | 2026-09-02 | 15M |
| `~/study/typescript/rushstack` | microsoft/rushstack | 2026-08-31 | 60M |
| `~/study/typescript/starlight-llms-txt` | delucis/starlight-llms-txt | 2026-09-01 | 1M |
| `~/study/typescript/starlight-typedoc` | HiDeoo/starlight-typedoc | 2026-08-12 | 4M |
| `~/study/typescript/typedoc` | TypeStrong/typedoc | 2026-07-13 | 10M |
| `~/study/typescript/typedoc-plugin-markdown` | typedoc2md/typedoc-plugin-markdown | 2026-08-26 | 13M |
| `~/study/typescript/vitepress` | vuejs/vitepress | 2026-08-30 | 10M |

## Staleness signals worth acting on

Three checkouts carry old HEADs, and in each case that shaped a recommendation:

| Tool | HEAD | Consequence |
|---|---|---|
| `gomarkdoc` | 2023-08-19 | Weighed against `doc2go` (2026-05-26) for the Go lane. See the Go document. |
| `exhale` | 2024-01-20 | Ruled out in favour of hand-written Breathe directives for C++. |
| `sphinx-multiversion` | 2025-11-24 | Broken against Sphinx 9; the fix has sat unmerged for 8 months. See `04-versioning.md`. |

`breathe` at 2025-12-01 is current enough to rely on.

## Not part of this research

`~/study/zig/ghostty` appears in filesystem listings from this period because it was
fetched on 2026-09-02, but the checkout was created 2026-07-30 and is unrelated to
documentation tooling. It is also a full clone rather than a shallow one.
