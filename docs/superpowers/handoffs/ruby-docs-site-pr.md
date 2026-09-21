# Proposed title

Docs(feat): Export versioned Ruby documentation

# Proposed body

## Summary

- **Export all four gems**: Generate one deterministic site artifact for `libtmux`, `libtmux-async`, `libtmux-mcp`, and `libtmux-workspace` from the public inventory, YARD objects, RBS declarations, behavior contracts, and tested examples.
- **Publish selected revisions**: Build pull requests, trunk, maintenance branches, release tags, and prerelease aliases from the exact selected source revision through the shared Astro shell.
- **Isolate deployments**: Queue publication runs, keep production and preview roles separate, write only the Ruby version and manifest prefixes, and clean only the closed preview.
- **Prepare package metadata**: Point the next authorized gem releases at their canonical core, reference, MCP, and workspace documentation pages.

## Changes by area

### Native export

- **Public inventory**: Export source-linked classes, modules, methods, signatures, products, and behavioral mappings for the complete gem suite.
- **Examples and guides**: Validate source regions and preserve gem-specific install and usage material for the site assembler.
- **Drift checks**: Reject nondeterministic output, internal leakage, missing contracts, broken source links, duplicate identifiers, and machine-specific paths.

### Documentation workflow

- **Revision binding**: Verify the requested source ref resolves to the checked-out commit before generating or publishing documentation.
- **Release handling**: Publish prerelease tags under immutable version prefixes and update `next` without treating an alpha as stable.
- **Credential boundaries**: Use the preview role for `pr-*` publication, the production role for release and branch trees, and a separate cleanup role for closed previews.

## Integrated version

The exporter and workflow are prepared against source release `v0.1.0.alpha.1`. The `libtmux`, `libtmux-async`, `libtmux-mcp`, and `libtmux-workspace` gems are all published as `0.1.0.alpha.1`.

## Design decisions

- **Native evidence**: Runtime inventory establishes what is public; YARD and RBS enrich documentation and signatures without inventing APIs.
- **One source revision**: The exporter, examples, guides, and source links all derive from the same checkout selected by the workflow.
- **No implicit publication**: This branch prepares the caller and package metadata but does not publish gems, documentation, releases, or repository metadata.

## Verification

Run the complete native gate:

```console
$ mise exec -- bundle exec scripts/check outer
```

Check the GitHub Actions workflows:

```console
$ mise exec -- actionlint
```

## Test plan

- [x] The outer gate covers unit and owned-socket integration behavior, installed gem imports and examples, public declaration coverage, rendered YARD and Markdown, RBS consumers, links, and fragments.
- [x] Export checks cover every published gem and reject stale or machine-bound output.
- [x] Workflow regression coverage proves pull-request publication selects the preview role.
- [ ] Hosted pull-request publication and cleanup require the public companion site revision and configured environments, secrets, OIDC trust, and prefix-scoped IAM roles.
- [ ] RubyGems documentation links take effect only in a subsequent authorized gem release.

## Setup required

1. Publish the exact companion `libtmux/docs` revision used by both workflow pins before pushing this branch.
2. Configure repository or organization secrets for the documentation bucket, distribution, production role, and preview role; configure the cleanup role where the cleanup job can read it.
3. Configure `docs`, `docs-preview`, and `docs-preview-cleanup` environments and restrict their accepted refs.
4. Verify the production role owns only `en/ruby/*` and `manifest/ruby.json`, and the preview and cleanup roles own only `en/ruby/pr-*`.
5. After production URLs work, update the repository description and homepage. Publish the gem metadata only through a separately authorized release.
