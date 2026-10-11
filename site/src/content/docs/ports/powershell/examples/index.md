---
port: powershell
route: examples
title: Examples
description: Complete programs with setup, expected output, and owned-server cleanup.
sidebar:
  label: Overview
  group: Examples
  order: 1
cards: [{"label": "Create windows and panes", "href": "./create-layout/", "body": "Create a session with two windows, then query a captured snapshot."}, {"label": "Check command completion", "href": "./command-completion/", "body": "Run a shell command and verify its authenticated nonzero exit status."}, {"label": "Wait for a service", "href": "./wait-for-service/", "body": "Wait for an HTTP readiness line and check the service responds."}]
---

Run a complete program for the task you need. Each page includes the entire
program, dependency setup, a run command, expected output, and cleanup.
The examples create private tmux servers and leave existing sessions alone.

Start with [create windows and panes](./create-layout/), then choose another task.
