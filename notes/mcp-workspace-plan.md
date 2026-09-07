# MCP and Workspace Manager local trial

The active goal authorizes a local implementation on `mcp-workspace-docs`.
Keep commits focused and keep every repository local. Preserve the existing
Astro shell, TypeScript 6 catalog, core URLs, and source worktrees.

## Content and routes

Store authored product pages in
`site/src/content/docs/ports/{port}/{product}/`. The collection records
`port` and `product`; a shared path resolver maps those entries to
`/{locale}/{port}/{version}/{product}/`. Product sections use the existing
reading layout and equivalent-page switcher. Global MCP pages remain
available at the locale root.

- [ ] Test product path resolution and equivalent-page availability.
- [ ] Add product metadata, route selection, scoped sidebars, and home cards.
- [ ] Author overview, topics, guides, examples, and API pages for both
  products across all eight ports, using verified source revisions.
- [ ] Check that each rendered port page contains its own instructions.

## Reference and provenance

Extend the shared API model with product ownership and source provenance.
Keep existing reference URLs, and reuse the renderer for scoped product API
pages. Extract protocol operations separately from public language APIs.

- [ ] Test per-symbol repository and revision links before changing extraction.
- [ ] Extract workspace and MCP APIs from the selected docs worktrees and
  separate Python repositories.
- [ ] Generate MCP registrations and available request/result schemas.
- [ ] Add product reference navigation and verify actual equivalent APIs.
- [ ] Refresh source excerpts, mentions, and generated catalogs.

## Integration and review

- [ ] Include product pages in locale search and machine-readable exports.
- [ ] Verify canonical URLs, real language alternatives, structured data,
  breadcrumbs, sitemaps, and nested Pagefind loading.
- [ ] Run the required outer loop before each implementation commit.
- [ ] Regenerate changed inputs, assemble the full site, and run the local
  publication audit. Report unavailable checks explicitly.
- [ ] Inspect desktop and mobile pages and execute representative examples
  in isolated environments where supported.
- [ ] Leave a local development server and full-build review server running.
- [ ] Give the user review URLs, build identity, results, and limitations;
  iterate on feedback before declaring design acceptance.
