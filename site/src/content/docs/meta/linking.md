---
title: Linking and consuming our docs
description: Find documentation exports for search engines, bots, LLMs and other documentation sites.
inventoryId: linking-and-consuming-docs
sidebar:
  group: Linking and consuming our docs
  label: Overview
  order: 89
---

We welcome bots, search engines, SEO tools, LLMs and other clients to use our
documentation. Read a page in your browser, fetch its Markdown, discover
pages through a manifest, or link to documented objects from another site.

## Choose an export

The page footer links to the exports for its documentation tree. Use those
links to select a language, version or preview.

| File or format | Use it for |
| --- | --- |
| [llms.txt](/llms.txt) | Discover guides, API references and agent prompts through a Markdown index. |
| [llms-full.txt](/llms-full.txt) | Fetch guides and MCP contracts together as Markdown. API references are linked separately. |
| [docs.json](/docs.json) | Discover page titles, URLs, descriptions, headings and Markdown URLs in a structured manifest. |
| Markdown | Read one page as text using its footer's **Markdown** link. |
| Raw source | Inspect the source file using its footer's **Raw source** link, where available. |
| [objects-full.inv](/objects-full.inv) | Resolve Sphinx references across shared docs, advertised port defaults and tmux reference versions. |
| objects.inv | Resolve Sphinx references within one port and version, or one tmux documentation tree. |
| [targets.json](/targets.json) | Browse inventory keys, display names and destination URLs as JSON. A scoped catalog sits beside each root inventory. |

The root exports above cover the assembled site. Port exports describe the
selected port and version. For a single API declaration, start with
`docs.json` and follow its reference and symbol-index links.

## Link from Sphinx

The [Intersphinx guide](/meta/intersphinx/) explains how to configure
inventories, choose native roles or portable labels, and preserve references
when a page moves or changes its title.

Browse [Intersphinx examples](/meta/intersphinx/examples/) for copyable RST
and MyST references to library APIs, tmux C declarations, hooks, format
variables, CLI commands and schema fields, paired with their destinations.

## Discover and index pages

Use the [sitemap](https://libtmux.org/en/sitemap-index.xml) to discover indexable pages. Follow
[robots.txt](https://libtmux.org/robots.txt) and each page's robots metadata:
pull-request previews, component demos and search-index shards are excluded
from crawling, and alternate versions can carry `noindex`.

Choose a versioned documentation tree when a reference needs a particular
release. The full inventory follows each port's advertised default; a
port's `objects.inv` describes the selected version.
