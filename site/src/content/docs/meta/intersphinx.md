---
title: Link to libtmux from Sphinx
description: Use Intersphinx inventories to reference libtmux APIs and documentation.
inventoryId: intersphinx
sidebar:
  group: Contributing
  order: 90
---

Sphinx can resolve references to libtmux APIs, guides, headings, MCP objects,
schema fields, and other documented targets. The footer links to the full
inventory and, on a port page, that port's inventory for the selected version.

## Configure Intersphinx

Enable the built-in extension in your project's `conf.py`:

```python
extensions = ["sphinx.ext.intersphinx"]
intersphinx_mapping = {
    "libtmux": (
        "https://libtmux.org/en/",
        "https://libtmux.org/en/objects-full.inv",
    ),
    "libtmux-python": ("https://libtmux.org/en/py/latest/", None),
}
```

`None` discovers `objects.inv` at the configured base URL. The port mapping
above selects the Python `latest` tree. Copy the base URL of another port
or version to select its inventory.

The full inventory includes shared documentation, the configured default
version of each assembled port, and distinct tmux reference versions.
It is generated after site assembly. Each port inventory includes the
rendered targets in that exact version.

## Choose a reference

Every exported target has a portable label that works with `std:ref`, without
installing a language or MCP domain. Open `targets.json` beside the inventory
and copy its `key`. Its `href` and `display` identify the destination.

For example, the Python `libtmux.Pane` declaration has this reStructuredText
reference:

```rst
:external+libtmux:ref:`Pane <py:core:api:libtmux.%50ane>`
```

With MyST enabled in your project, the same label works in Markdown:

```markdown
{external+libtmux:ref}`Pane <py:core:api:libtmux.%50ane>`
```

Native Python, C++, JavaScript, and C objects also have aliases for their
built-in roles. A scoped Python inventory supports:

```rst
:external+libtmux-python:py:class:`libtmux.Pane`
```

Command options also work with Sphinx's program context:

```rst
.. program:: tmuxp load

:external+libtmux-python:option:`--append`
```

The full inventory qualifies native names by port, such as
`py:libtmux.Pane`. A fully qualified alias includes the product too:
`py:core:libtmux.Pane`. Short aliases are offered only when they identify
one destination. Configuration values, command options, environment
variables, and glossary terms use standard-domain types where their
renderers identify those semantics.

## Stable labels

A portable key contains `scope:product:category:identity`. Its encoding
preserves uppercase letters, punctuation, and Unicode, because `std:ref`
lowercases targets. `%50ane` and `pane` therefore remain distinct.
Copy the key from the catalog without decoding its percent escapes.

Keys are independent of display titles and destination URLs. API public IDs,
protocol wire identities, JSON Pointers, named parameters, and native method
identities supply their names. Authored documents can retain `inventoryId`
and explicit HTML fragment IDs when their titles or routes change.
Contributors preserve renamed keys in the inventory alias catalog and use
the existing page redirect mechanism for retired routes.

Existing `objects.inv` and `reference/objects.inv` endpoints remain compatibility
exports. New integrations should use the full inventory or a port's root
inventory to obtain the complete target catalog and case-safe labels.

See the [Sphinx Intersphinx documentation](https://www.sphinx-doc.org/en/master/usage/extensions/intersphinx.html)
for named inventories and cross-reference syntax.
