---
title: "tmuxp compatibility and port status"
description: "Separate parser acceptance, builder behavior, proposed CLI services, and installed capabilities."
port: py
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.

The reference is Python tmuxp 1.74.0 at the source revision linked below. A
native workspace library, parser experiment, and installed CLI are different
deliverables. None of the seven native ports currently supplies the full
command-line application described by the compatibility proposal.

## This port

Python tmuxp is the executable reference. Its YAML normalization, loader,
capture, importers, search, shell, and plugins establish the comparison
behavior. Current machine-output exceptions remain documented on the command
pages.

These observations are a dated local research snapshot, not a support guarantee
for a published artifact. Read the port's [builder
topics](../../internals/topics/) and [API](../../internals/api/) for the actual
library interface. Use the page's language switcher to compare the same topic
across ports.

## Shared gaps

Full parity needs document discovery and conversion, schema normalization,
load/attach/append policy, capture, search, editor execution, diagnostics, and
Python shell/plugin compatibility. Accepting YAML without rejecting unknown keys
can silently lose behavior. Passing a parser probe does not establish execution
parity.

Python shell switches and plugin import paths need a Python bridge or an
explicitly unsupported result. Regex behavior also differs by language;
identical search flags do not imply Python regular-expression semantics. See
[shell](../../cli/shell/), [search](../../cli/search/), and
[hooks](../../configuration/hooks/).

## Optional format separator

Python libtmux exposes `LIBTMUX_TMUX_FORMAT_SEPARATOR` in its format collector.
Native ports use different framing and decoding strategies. This prototype does
not claim support for the variable in those codecs. A port needs an explicit
compatible seam and live tests for collisions, empty values, Unicode, and line
breaks before accepting the setting.

## Reading examples

The [gallery](../../examples/gallery/) contains the upstream fixture corpus.
Parsing a fixture and executing its applications are separate checks. Several
require external programs, remote hosts, project directories, or plugin
packages. Current native gaps remain visible even when a YAML reader accepts the
file.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
