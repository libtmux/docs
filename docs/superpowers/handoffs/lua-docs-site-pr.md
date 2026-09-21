# Proposed title

Docs(feat): Export versioned Lua documentation

# Proposed body

## Summary

- **Export the public Lua surface**: Generate deterministic LuaLS-backed documentation for core modules, query APIs, and the standalone luv and Neovim runtimes.
- **Verify source examples**: Add a runnable quickstart and preserve source-backed guide and declaration coverage without using MCP or workspace scaffolds as export inputs.
- **Publish selected revisions**: Build pull requests, trunk, maintenance branches, release tags, and prerelease aliases from the exact selected source revision through the shared Astro shell.
- **Isolate deployments**: Queue publication runs, keep production and preview roles separate, write only the Lua version and manifest prefixes, and clean only the closed preview.

## Changes by area

### Native export

- **LuaLS model**: Export public modules, fields, functions, types, runtime targets, documentation, signatures, and source locations through an isolated annotated source copy.
- **Release integrity**: Keep the tagged source rock unchanged while validating the generated model and installed examples against the selected source.
- **Availability boundary**: Exclude committed MCP and workspace scaffolds because those products are not implemented or published.

### Documentation workflow

- **Revision binding**: Verify the requested source ref resolves to the checked-out commit before generating or publishing documentation.
- **Release handling**: Publish prerelease tags under immutable version prefixes and update `next` without treating an alpha as stable.
- **Credential boundaries**: Use the preview role for `pr-*` publication, the production role for release and branch trees, and a separate cleanup role for closed previews.

## Integrated version

The exporter and workflow are prepared against source release `v0.1.0alpha1` and the published `libtmux` rock `0.1.0alpha1-1`. No Lua MCP or workspace package is published.

## Design decisions

- **Lua-native extraction**: LuaLS supplies declarations and diagnostics; the exporter verifies public-module coverage instead of translating another port's object model.
- **Runtime-specific evidence**: Standalone luv and Neovim declarations stay distinguishable, and Linux verification does not claim untested macOS compatibility.
- **No implicit publication**: This branch prepares the caller and exporter but does not publish rocks, documentation, releases, or repository metadata.

## Verification

Run the complete native gate:

```console
$ mise exec -- python scripts/check.py outer
```

Check the GitHub Actions workflows:

```console
$ mise exec -- actionlint
```

## Test plan

- [x] The outer gate covers unit behavior, owned-socket luv and Neovim integration, isolated package builds and imports, installed examples, LuaLS diagnostics, and editor completion.
- [x] Export checks reject runtime annotation leakage, product scaffolds, nondeterministic output, source drift, and incomplete public-module coverage.
- [x] Workflow regression coverage proves pull-request publication selects the preview role.
- [ ] Hosted pull-request publication and cleanup require the public companion site revision and configured environments, secrets, OIDC trust, and prefix-scoped IAM roles.
- [ ] macOS runtime coverage and a wider compatibility matrix remain separate support gates.

## Setup required

1. Publish the exact companion `libtmux/docs` revision used by both workflow pins before pushing this branch.
2. Configure repository or organization secrets for the documentation bucket, distribution, production role, and preview role; configure the cleanup role where the cleanup job can read it.
3. Configure `docs`, `docs-preview`, and `docs-preview-cleanup` environments and restrict their accepted refs.
4. Verify the production role owns only `en/lua/*` and `manifest/lua.json`, and the preview and cleanup roles own only `en/lua/pr-*`.
5. After production URLs work, update the repository description and homepage. Change the rock documentation homepage only through a separately authorized release.
