---
title: Concept examples
description: Use MCP servers and workspace builders to exercise libtmux, and understand their support scope.
supportedPorts: []
sidebar:
  group: Guides
  order: 90
---

Use the non-Python MCP servers and workspace builders as maintained examples
of libtmux usage and deployment. Their menu badge says **concept**. Maintainers
use them to dogfood the core library through a real application, including
configuration and packaging.

## Concept and alpha

**Concept** describes support scope. These examples do not carry a product
support or compatibility commitment. Their APIs, MCP tools, command output
and workspace configuration can change. Pin the example and core library
revisions together when you adapt one.

**Alpha** describes release maturity. Publishing a package, adding commands
or fixing an example does not change its concept scope. An alpha core library
can have concept examples alongside it.

A badge names the release stage that a package's registry declares, or the
stage in its newest version: **pre-alpha**, **alpha**, **beta**, **rc** or
**stable**. A package with no published release shows **unreleased**.

Python's `tmuxp` workspace loader and Python MCP server show the stage their
PyPI projects declare instead of **concept**. A language without an
implementation has no badge.

## Use an example

Open your language's MCP or Workspace Manager menu entry. Its installation
guide names the package or source build, runtime requirements and tmux
endpoint. The example and its language API remain available to read, run and
adapt.

Markdown copies retain the concept scope. Protocol JSON contains the server's
advertised contracts; the [agent manifest](../../../docs.json) records the
companion's concept scope.

Keep tmux access local or behind access controls you own. An MCP tool can
send shell input, and a workspace file can configure shell commands. A concept
badge does not provide authentication, authorization or isolation.

## Check and report failures

A concept example needs to work at its documented revision. Exercise a
workspace load and inspect the resulting session, or connect an MCP client
and call an advertised tool. Check output, errors and cleanup against an
isolated tmux server. A page that renders or a package that installs does
not establish those results.

Use the [tmux socket selection options](/tmux/latest/manual/full/#DESCRIPTION)
to keep the test server separate from your normal sessions.

Report a failing example with its revision, tmux version, smallest input and
observed error. If the failure comes from the core library, reduce it to a
core API call. The example is useful evidence for improving the library;
its concept status does not excuse a broken core contract.

For an application you operate, own its configuration compatibility,
upgrade policy, access controls and monitoring. Start from the example and
test the behavior your application needs.
