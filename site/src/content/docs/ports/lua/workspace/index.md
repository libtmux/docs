---
title: Workspace Manager for Lua is not published
description: The Lua repository contains a workspace scaffold, not a loader or supported builder API.
port: lua
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Lua has no published libtmux workspace manager. The repository's workspace
directory is a scaffold: it does not provide an installable package, workspace
loader command, supported file format, or product API.

This page records availability without advertising placeholder code. There is
no Lua equivalent of `libtmux-workspace validate`, `plan`, or `load`, and no
workspace reference tree is generated.

Use the core Lua API to create sessions, windows, and panes explicitly. A
workspace tool from another language remains a separate application with its
own configuration contract; it is not a Lua feature.
