# libtmux.org

Unified documentation site for every libtmux language port.

Private while under construction.

| | |
|---|---|
| Site | https://libtmux.org |
| Shell | Astro 7, own layouts and components — no documentation framework |
| Hosting | S3 + CloudFront behind Cloudflare |

## Layout

```
site/          Astro shell: landing, concepts, guides, examples, parity, search
ingest/        Loaders that turn each port's API model into content collections
infra/         CloudFront function, bucket policy, deploy workflows
docs/          Design notes and decisions for this repo itself
```

## Ports

| Port | Reference rendered by | Canonical ecosystem host |
|---|---|---|
| Python | Sphinx (self-hosted) | — |
| C++ | Doxygen XML to Breathe to Sphinx (self-hosted) | — |
| TypeScript | api-extractor JSON to Astro | — |
| .NET | docfx metadata YAML to Astro | — |
| Go | doc2go `-embed` to Astro | pkg.go.dev |
| Rust | rustdoc, skinned | docs.rs |
| Java + Kotlin | Dokka, skinned | javadoc.io |
| Swift | DocC, skinned | Swift Package Index |
