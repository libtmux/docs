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

- [x] Test product path resolution and equivalent-page availability.
- [x] Add product metadata, route selection, scoped sidebars, and home cards.
- [x] Author overview, topics, guides, examples, and API pages for both
  products across all eight ports, using verified source revisions.
- [x] Check that each rendered port page contains its own instructions.

## Reference and provenance

Extend the shared API model with product ownership and source provenance.
Keep existing reference URLs, and reuse the renderer for scoped product API
pages. Extract protocol operations separately from public language APIs.

- [x] Test per-symbol repository and revision links before changing extraction.
- [x] Extract workspace and MCP APIs from the selected docs worktrees and
  separate Python repositories.
- [x] Generate MCP registrations and available request/result schemas.
- [x] Add product reference navigation and verify actual equivalent APIs.
- [x] Refresh source excerpts, mentions, and generated catalogs.

## Integration and review

- [x] Include product pages in locale search and machine-readable exports.
- [x] Verify canonical URLs, real language alternatives, structured data,
  breadcrumbs, sitemaps, and nested Pagefind loading.
- [x] Run the required outer loop before each implementation commit.
- [x] Regenerate changed inputs, assemble the full site, and run the local
  publication audit. Report unavailable checks explicitly.
- [x] Inspect desktop and mobile pages and execute representative examples
  in isolated environments where supported.
- [x] Leave a local development server and full-build review server running.
- [ ] Give the user review URLs, build identity, results, and limitations;
  iterate on feedback before declaring design acceptance.

## Reference audit

The expanded reference retains some names as plain text because they have no
documentation target. Python's ceiling is 138: new conditional CLI aliases,
launch types, and a private callback alias add 56 occurrences, while typing
links remove 20. Go's ceiling is 107: named return labels add four occurrences
and a `uint64` link removes one. C++'s ceiling is 259: `const` qualifiers and
the declared `Integer` template parameter add 23 occurrences, while `char`
links remove four. The other ports meet their previous ceilings.

Java's reference floor is 1,647 after excluding 13 package-private overloads
from public method groups. Comparing all Java output pages confirms that
retained signatures lose no links and no page or export disappears. The
other ports have higher reference floors after the dependency-link audit.

Swift's graph records inherited origins for declarations without source
locations. These remain visible without fabricated source links. The
fidelity check requires a source link whenever the model supplies one and
keeps unexplained missing locations in its coverage denominator.

The visual baselines include the added Go MCP module and API counts, new
symbol-index entries, and the Swift MCP example backlink. Desktop and mobile
layouts retain the existing shell and typography.

## Local verification

The complete publication audit passes for the assembled site: 15,627 HTML
pages, 1,982,767 checked links, and no broken targets. All 204 output tests,
235 API-model tests, and 36 theme tests pass. Browser checks cover 36 visual
comparisons, 24 navigation checks, and 78 table layouts, plus fonts, native
navigation, and Sphinx style parity. All publication stages ran.

The final outer loop passes in 37.30 seconds, within its 60-second budget.
One earlier output run hit three test timeouts; unchanged standalone runs
and the complete rerun passed. No timeout limits or concurrency defaults
were changed.

Runtime protocol discovery covers all eight ports. Representative workspace
examples ran across the ports; the C++ YAML example and full C++ consumer
suite remain unexecuted. Some MCP embedding examples received compilation
checks rather than execution; runtime discovery validates their registered
protocol surface separately.

The complete preview runs on ports 8081 and 8082. The development server on
port 4321 provides live content; use the complete preview for assembled
port navigation and search. The Go install guide selects `@latest`, and its
workspace overview links the `tmuxp` name to the upstream documentation.
Section-structure and visual acceptance remain pending user review.
