---
port: julia
route: examples
title: Examples
description: Complete programs with setup, expected output, and owned-server cleanup.
sidebar:
  label: Overview
  group: Examples
  order: 1
cards: [{"label": "Capture a pane", "href": "./owned-capture/", "body": "Capture a blank pane and verify owned-server cleanup."}, {"label": "Query shared windows", "href": "./shared-windows/", "body": "Distinguish windows, session links, and pane occurrences."}, {"label": "Cancel a control wait", "href": "./cancel-control-wait/", "body": "Cancel a control signal wait without closing its connection."}, {"label": "Observe pane output", "href": "./observe-output/", "body": "Capture a baseline and verify the bytes of a Unicode terminal echo."}]
---

Run a complete program for the task you need. Each page includes the entire
program, dependency setup, a run command, expected output, and cleanup.
The examples create private tmux servers and leave existing sessions alone.

Start with [capture a pane](./owned-capture/), then choose another task.
