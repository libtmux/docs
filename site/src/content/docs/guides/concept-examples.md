---
title: Concept examples
description: Use MCP servers and workspace builders to exercise libtmux, and understand their support scope.
supportedPorts: []
sidebar:
  group: Guides
  order: 90
---

Non-Python MCP servers and workspace builders are maintained examples of
libtmux in use. They let maintainers dogfood the core library through a real
application, including configuration, packaging and deployment. Their menu
badge says **concept**.

## Concept and alpha

**Concept** describes support scope. These examples do not carry a product
support or compatibility commitment. Their APIs, MCP tools, command output
and workspace configuration can change. Pin the example and core library
revisions together when you adapt one.

**Alpha** describes release maturity. Publishing a package, adding commands
or fixing an example does not change its concept scope. An alpha core library
can have concept examples alongside it.

Python's `tmuxp` workspace loader and Python MCP server keep their own
documented status. A language without an implementation has no concept badge.

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

## Keep dogfooding useful

A concept example needs to work at its documented revision. Exercise a
workspace load and inspect the resulting session, or connect an MCP client
and call an advertised tool. Check output, errors and cleanup against an
isolated tmux server. A page that renders or a package that installs does
not establish those results.

Report a failing example with its revision, tmux version, smallest input and
observed error. If the failure comes from the core library, reduce it to a
core API call. The example is useful evidence for improving the library;
its concept status does not excuse a broken core contract.

For an application you operate, own its configuration compatibility,
upgrade policy, access controls and monitoring. Start from the example and
test the behavior your application needs.
